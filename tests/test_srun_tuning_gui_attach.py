"""Endpoint <-> local switches in the startup GUI config helpers."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import srun_tuning_gui as gui  # noqa: E402


class AttachSwitchTest(unittest.TestCase):
    def test_back_to_local_drops_the_endpoint_model_id(self):
        # WP16 live: after Vitronia -> DS4 local, requestDefaults.model stayed
        # "qwen3.8-flash-next-vitronia" and the epistemic client sent it to DS4.
        config = {
            "server": {"binary": "./ds4-wrapper", "host": "127.0.0.1", "port": 8002},
            "wrapper": {"enabled": True},
            "requestDefaults": {"temperature": 0},
        }
        endpoint = gui.Endpoint(name="Vitronia", base_url="http://127.0.0.1:8732/v1",
                                model="qwen3.8-flash-next-vitronia", request_defaults=())
        gui.apply_endpoint(config, endpoint, endpoint.model)
        self.assertEqual(config["requestDefaults"]["model"], "qwen3.8-flash-next-vitronia")

        gui.apply_local(config)
        self.assertNotIn("model", config["requestDefaults"])
        self.assertEqual(config["server"]["port"], 8002)
        self.assertTrue(config["wrapper"]["enabled"])

    def test_back_to_local_restores_a_saved_local_model(self):
        config = {
            "server": {"binary": "./ds4-wrapper", "host": "127.0.0.1", "port": 8002},
            "wrapper": {"enabled": True},
            "requestDefaults": {"model": "deepseek-v4-flash"},
        }
        endpoint = gui.Endpoint(name="Vitronia", base_url="http://127.0.0.1:8732/v1",
                                model="qwen3.8-flash-next-vitronia", request_defaults=())
        gui.apply_endpoint(config, endpoint, endpoint.model)
        gui.apply_local(config)
        self.assertEqual(config["requestDefaults"]["model"], "deepseek-v4-flash")


if __name__ == "__main__":
    unittest.main()
