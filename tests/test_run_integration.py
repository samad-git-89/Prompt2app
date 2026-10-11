import unittest

from run_integration import transform_profile
from training.scripts.dataset_pipeline import LOCKED_CLASSES


def profile_for(detections):
    return {
        "classes": [
            {"class_id": class_id, "class_name": class_name}
            for class_id, class_name in enumerate(LOCKED_CLASSES)
        ],
        "bounding_box_format": "xyxy_pixels",
        "images": [{
            "image": "mock.png",
            "width": 640,
            "height": 480,
            "detections": detections,
        }],
    }


class TransformProfileTests(unittest.TestCase):
    def test_maps_each_locked_class_and_preserves_layout_geometry(self):
        detections = [
            {
                "class_id": class_id,
                "class_name": class_name,
                "confidence": 0.9,
                "bounding_box": {
                    "x1": 10.0 + class_id,
                    "y1": 20.0,
                    "x2": 110.0 + class_id,
                    "y2": 80.0,
                    "format": "xyxy",
                    "units": "pixels",
                },
            }
            for class_id, class_name in enumerate(LOCKED_CLASSES)
        ]

        spec = transform_profile(profile_for(detections), "mock.png")

        self.assertEqual(spec["pages"][0]["components"], list(LOCKED_CLASSES))
        self.assertIn('"x1":10.0', spec["pages"][0]["purpose"])
        self.assertEqual(spec["data_models"], [])

    def test_rejects_class_id_name_mismatch(self):
        detection = {
            "class_id": 0,
            "class_name": "input",
            "confidence": 0.9,
            "bounding_box": {
                "x1": 1,
                "y1": 1,
                "x2": 10,
                "y2": 10,
                "format": "xyxy",
                "units": "pixels",
            },
        }
        with self.assertRaisesRegex(ValueError, "does not map"):
            transform_profile(profile_for([detection]), "mock.png")


if __name__ == "__main__":
    unittest.main()
