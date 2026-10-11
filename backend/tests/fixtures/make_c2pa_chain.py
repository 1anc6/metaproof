"""Rebuilds tests/fixtures/c2pa_ai_original_then_edited.png: a real signed C2PA chain shaped like a
Gemini download (an AI-generated parent, then opened -> edited (composite) -> converted).
Signed with a throwaway test certificate valid for 50 years. Needs `cryptography`:

    python tests/fixtures/make_c2pa_chain.py
"""
import datetime as dt
import io

import c2pa
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from PIL import Image


def name(cn): return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MetaProof Test")])
now = dt.datetime.now(dt.UTC)
ca_key = ec.generate_private_key(ec.SECP256R1())
ca = (x509.CertificateBuilder().subject_name(name("Test Root")).issuer_name(name("Test Root"))
      .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
      .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=365 * 50))
      .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
      .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
      .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
      .sign(ca_key, hashes.SHA256()))
key = ec.generate_private_key(ec.SECP256R1())
leaf = (x509.CertificateBuilder().subject_name(name("Test Generator")).issuer_name(ca.subject)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=365 * 50))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256()))
chain = leaf.public_bytes(serialization.Encoding.PEM) + ca.public_bytes(serialization.Encoding.PEM)
pkey = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
signer = c2pa.Signer.from_info(c2pa.C2paSignerInfo(c2pa.C2paSigningAlg.ES256, chain, pkey, None))

IPTC = "http://cv.iptc.org/newscodes/digitalsourcetype/"
img = Image.new("RGB", (640, 384), (40, 60, 120)); buf = io.BytesIO(); img.save(buf, "PNG")

# Step 1: the generator signs "created, trainedAlgorithmicMedia".
gen = c2pa.Builder({"claim_generator_info": [{"name": "Test Generator", "version": "1.0"}],
                    "assertions": [{"label": "c2pa.actions", "data": {"actions": [
                        {"action": "c2pa.created", "digitalSourceType": IPTC + "trainedAlgorithmicMedia"}]}}]})
parent = io.BytesIO()
gen.sign(signer, "image/png", io.BytesIO(buf.getvalue()), parent)

# Step 2: post-processing opens that file, composites (e.g. a logo) and converts it.
child_manifest = {"claim_generator_info": [{"name": "Test Post-processor", "version": "1.0"}],
                  "assertions": [{"label": "c2pa.actions", "data": {"actions": [
                      {"action": "c2pa.opened", "parameters": {"ingredientIds": ["generated-original"]}},
                      {"action": "c2pa.edited", "digitalSourceType": IPTC + "composite"},
                      {"action": "c2pa.converted"}]}}]}
post = c2pa.Builder(child_manifest)
parent.seek(0)
post.add_ingredient({"title": "generated.png", "relationship": "parentOf", "label": "generated-original"}, "image/png", parent)
out = io.BytesIO()
parent.seek(0)
post.sign(signer, "image/png", io.BytesIO(parent.getvalue()), out)
with open(__file__.replace("make_c2pa_chain.py", "c2pa_ai_original_then_edited.png"), "wb") as f:
    f.write(out.getvalue())

