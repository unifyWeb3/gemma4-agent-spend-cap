"""Run the task test functions and report the result.

The harness calls this from the task directory. It imports test_task.py,
runs every function whose name starts with test_, and exits non zero when any
of them fail. Plain asserts only, no test framework needed.
"""

import importlib.util
import sys
import traceback
from pathlib import Path


def main() -> int:
    workdir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    sys.path.insert(0, str(workdir))

    spec = importlib.util.spec_from_file_location("test_task", workdir / "test_task.py")
    if spec is None or spec.loader is None:
        print("no test_task.py in the task directory")
        return 2
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    tests = [(name, fn) for name, fn in vars(module).items() if name.startswith("test_") and callable(fn)]
    if not tests:
        print("no test functions found")
        return 2

    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception:
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()

    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
