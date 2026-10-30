from app.memory import process_memory_mb


def test_reads_resident_and_peak_memory_from_proc(tmp_path):
    status = tmp_path / "status"
    status.write_text("Name:\tuvicorn\nVmHWM:\t  457728 kB\nVmRSS:\t  262144 kB\nThreads:\t4\n")
    assert process_memory_mb(status) == (256.0, 447.0)


def test_no_figures_without_proc(tmp_path):
    assert process_memory_mb(tmp_path / "missing") == (None, None)
    (tmp_path / "odd").write_text("VmRSS: lots\n")
    assert process_memory_mb(tmp_path / "odd") == (None, None)
