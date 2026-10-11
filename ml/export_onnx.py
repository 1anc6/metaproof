"""Step 5: package CLIP image encoder + trained head as one ONNX model for the API.

The graph takes a normalized 224x224 image and returns P(AI-generated), already calibrated,
plus the L2-normalized CLIP embedding that the API stores for near-duplicate search.
An 8-bit weight-only copy (MatMulNBits: weights stored in 8 bits, maths in fp32) is what
ships: 121 MB and ~350 MB peak RAM, which fits the 512 MB Render instance. Dynamic int8
quantization was rejected because quantizing CLIP's activations cost ~0.03 AUC; weight-only
8-bit changes probabilities by 0.003 on average (see eval_onnx.py).

    python export_onnx.py --backbone vitb32
    python export_onnx.py --backbone vitb32 --upload 1anc6/metaproof-detector
"""

import argparse
import json
import shutil
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import open_clip
import torch
import onnx
from onnxruntime.quantization.matmul_nbits_quantizer import (
    DefaultWeightOnlyQuantConfig,
    MatMulNBitsQuantizer,
)

from common import BACKBONES, DATA_DIR
from train import Head

OUT = DATA_DIR / "export"


class Detector(torch.nn.Module):
    def __init__(self, visual, head: Head, temperature: float):
        super().__init__()
        self.visual, self.head = visual, head
        self.register_buffer("temperature", torch.tensor(float(temperature)))

    def forward(self, pixels):
        f = torch.nn.functional.normalize(self.visual(pixels), dim=-1)
        return torch.sigmoid(self.head(f) / self.temperature), f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backbone", default="vitb32", choices=list(BACKBONES))
    ap.add_argument("--upload", help="Hugging Face model repo, e.g. 1anc6/metaproof-detector")
    args = ap.parse_args()

    arch, pretrained, _ = BACKBONES[args.backbone]
    clip, _, _ = open_clip.create_model_and_transforms(arch, pretrained=pretrained)
    ckpt = torch.load(DATA_DIR / f"head_{args.backbone}.pt")
    head = Head(ckpt["dim"])
    head.load_state_dict(ckpt["state_dict"])
    model = Detector(clip.visual.float().eval(), head.eval(), ckpt["temperature"]).eval()

    OUT.mkdir(parents=True, exist_ok=True)
    fp32 = OUT / f"detector_{args.backbone}_fp32.onnx"
    w8 = OUT / f"detector_{args.backbone}_w8.onnx"
    dummy = torch.randn(2, 3, 224, 224)
    torch.onnx.export(model, (dummy,), fp32, input_names=["pixels"],
                      output_names=["p_ai", "embedding"],
                      dynamic_axes={"pixels": {0: "batch"}, "p_ai": {0: "batch"},
                                    "embedding": {0: "batch"}},
                      opset_version=17, dynamo=False)
    cfg = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=8)
    quantizer = MatMulNBitsQuantizer(onnx.load(str(fp32)), bits=8, block_size=32,
                                     is_symmetric=True, algo_config=cfg)
    quantizer.process()
    quantizer.model.save_model_to_file(str(w8), use_external_data_format=False)

    # Parity check on random inputs, plus single-image CPU latency.
    x = torch.randn(8, 3, 224, 224)
    with torch.no_grad():
        ref = model(x)[0].numpy()
    report = {"backbone": args.backbone, "temperature": ckpt["temperature"]}
    for name, path in (("fp32", fp32), ("w8", w8)):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1  # Render's free tier has a fraction of one CPU
        sess = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
        out = sess.run(None, {"pixels": x.numpy()})[0]
        one = x[:1].numpy()
        sess.run(None, {"pixels": one})
        t = time.perf_counter()
        for _ in range(5):
            sess.run(None, {"pixels": one})
        report[name] = {
            "size_mb": round(path.stat().st_size / 1e6, 1),
            "max_abs_diff_vs_torch": float(np.abs(out - ref).max()),
            "ms_per_image_1_thread": round((time.perf_counter() - t) / 5 * 1000),
        }
    print(json.dumps(report, indent=2))
    Path(f"export_{args.backbone}.json").write_text(json.dumps(report, indent=2))

    if args.upload:
        from huggingface_hub import HfApi

        api = HfApi()
        api.create_repo(args.upload, repo_type="model", exist_ok=True)
        card = OUT / "README.md"
        shutil.copy(Path(__file__).with_name("MODEL_CARD.md"), card)
        # The API downloads this exact name at Docker build time.
        api.upload_file(path_or_fileobj=w8, path_in_repo="detector.onnx", repo_id=args.upload)
        api.upload_file(path_or_fileobj=card, path_in_repo="README.md", repo_id=args.upload)
        results = Path(f"results_{args.backbone}.json")
        if results.exists():
            api.upload_file(path_or_fileobj=results, path_in_repo="results.json", repo_id=args.upload)
        print(f"uploaded to https://huggingface.co/{args.upload}")


if __name__ == "__main__":
    main()
