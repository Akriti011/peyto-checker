"""Start ALL fake systems for demo mode in one go.

  python -m mock_systems.run_mocks

  Fake Chitragupt  -> http://127.0.0.1:8101   (login: any user / demo)
  Fake T3 node     -> ssh 127.0.0.1 -p 2201  (any user / demo)
  Fake T4 node     -> ssh 127.0.0.1 -p 2202  (any user / demo)
"""
import os
import uvicorn

from mock_systems import ssh_node_mock
from mock_systems.chitragupt_mock import app
from mock_systems.common import split

if __name__ == "__main__":
    chit, nodes = split()
    print(f"[mock] Chitragupt knows {len(chit)} LSIs; SSH-only: T3={list(nodes['T3'])} T4={list(nodes['T4'])}")
    ssh_node_mock.start_background()
    uvicorn.run(app, host=os.getenv("MOCK_HOST", "127.0.0.1"), port=int(os.getenv("MOCK_CHITRAGUPT_PORT", "8101")),
                log_level="warning")
