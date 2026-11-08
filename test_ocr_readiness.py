"""Readiness endpoints use an isolated DB and a fake OCR constructor."""
import sys
import threading
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch
from test_api_regressions import ApiRegressionTests as Fixture


class OcrReadinessTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.module = self.fixture.module
        self.client = self.fixture.worker

    def test_auth_and_cold_warm_status(self):
        guest = self.fixture.app.test_client()
        for path, method in [('/api/ocr/status', 'get'), ('/api/ocr/prepare', 'post')]:
            self.assertEqual(getattr(guest, method)(path).status_code, 401)
        response = self.client.get('/api/ocr/status')
        self.assertFalse(response.json['ready'])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        constructor = Mock(return_value=object())
        with patch.dict(sys.modules, {'rapidocr_onnxruntime': types.SimpleNamespace(RapidOCR=constructor)}):
            self.assertTrue(self.client.post('/api/ocr/prepare').json['ready'])
            self.assertTrue(self.client.post('/api/ocr/prepare').json['ready'])
        constructor.assert_called_once()
        self.assertTrue(self.client.get('/api/ocr/status').json['ready'])

    def test_failed_initialization_can_retry(self):
        constructor = Mock(side_effect=[RuntimeError('test failure'), object()])
        with patch.dict(sys.modules, {'rapidocr_onnxruntime': types.SimpleNamespace(RapidOCR=constructor)}):
            self.assertEqual(self.client.post('/api/ocr/prepare').status_code, 503)
            self.assertFalse(self.client.get('/api/ocr/status').json['ready'])
            self.assertTrue(self.client.post('/api/ocr/prepare').json['ready'])

    def test_parallel_requests_initialize_once(self):
        started, release = threading.Event(), threading.Event()
        engine = object()
        def construct():
            started.set()
            self.assertTrue(release.wait(3))
            return engine
        constructor = Mock(side_effect=construct)
        with patch.dict(sys.modules, {'rapidocr_onnxruntime': types.SimpleNamespace(RapidOCR=constructor)}):
            with ThreadPoolExecutor(max_workers=4) as pool:
                first = pool.submit(self.module.ensure_ocr_engine)
                self.assertTrue(started.wait(3))
                others = [pool.submit(self.module.ensure_ocr_engine) for _ in range(3)]
                self.assertFalse(self.client.get('/api/ocr/status').json['ready'])
                release.set()
                self.assertIs(first.result(), engine)
                for future in others:
                    self.assertIs(future.result(), engine)
        constructor.assert_called_once()
