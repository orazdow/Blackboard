import base64
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from blackboard import Blackboard, GitHubError, _decode_message


def issue(number, **extra):
    return {"number": number, "title": f"💬 topic-{number}", "body": "Description",
            "state": "open", "html_url": "https://github.com/example/board", **extra}


class BlackboardTests(unittest.TestCase):
    def test_sender_round_trip(self):
        board = Blackboard()
        def respond(method, path, body):
            self.assertEqual(body["body"], '<!-- blackboard: {"sender":"dot"} -->\nHello')
            return {"id": 1, "body": body["body"], "user": {"login": "lyra-relay[bot]"}, "created_at": "2026-10-20T19:00:00Z", "html_url": "https://github.com/example/board"}
        with patch.object(board, "_request", side_effect=respond):
            sent = board.send_message(1, "Hello", sender="dot")
        self.assertEqual(sent["sender"], "dot")
        self.assertEqual(sent["author"], "lyra-relay[bot]")
        self.assertEqual(sent["text"], "Hello")

    def test_shared_metadata_examples(self):
        path = Path(__file__).resolve().parents[1] / "client/test/message-metadata.json"
        for example in json.loads(path.read_text(encoding="utf-8")):
            with self.subTest(body=example["body"]):
                self.assertEqual(_decode_message(example["body"]), {"sender": example["sender"], "text": example["text"]})

    def test_invalid_senders_never_make_requests(self):
        board = Blackboard()
        with patch.object(board, "_request") as request:
            for sender in ["", "Dot", "dot\n", "a" * 65, 42]:
                with self.assertRaises(ValueError):
                    board.send_message(1, "Hello", sender=sender)
            request.assert_not_called()

    def test_jwt_signature_and_claims(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        with tempfile.TemporaryDirectory() as folder:
            pem = Path(folder) / "test.pem"
            pem.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
            with patch("blackboard.time.time", return_value=1800000000):
                token = Blackboard(key_path=pem)._app_jwt()
        header, payload, signature = token.split(".")
        decode = lambda part: base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
        key.public_key().verify(decode(signature), f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256())
        self.assertEqual(json.loads(decode(header))["alg"], "RS256")
        claims = json.loads(decode(payload))
        self.assertEqual(claims, {"iss": "5405206", "iat": 1799999940, "exp": 1800000540})

    def test_token_is_cached_then_renewed_before_expiry(self):
        board = Blackboard()
        expiration = datetime.fromtimestamp(time.time() + 3600, timezone.utc).isoformat()
        with patch.object(board, "_app_jwt", return_value="test-jwt"), patch.object(board, "_http", return_value={"token": "test-token", "expires_at": expiration}) as http:
            self.assertEqual(board._installation_token(), "test-token")
            self.assertEqual(board._installation_token(), "test-token")
            self.assertEqual(http.call_count, 1)
            self.assertEqual(http.call_args.args[3], {"repositories": ["Blackboard"], "permissions": {"issues": "write"}})
            board._expires_at = time.time() + 30
            board._installation_token()
            self.assertEqual(http.call_count, 2)

    def test_pagination_and_channel_filtering(self):
        board = Blackboard()
        pages = [[issue(i) for i in range(1, 101)],
                 [issue(101), issue(102, title="Other"), issue(103, pull_request={})]]
        with patch.object(board, "_request", side_effect=pages) as request:
            channels = board.list_channels()
        self.assertEqual(len(channels), 101)
        self.assertEqual(channels[0]["id"], 1)
        self.assertIn("page=2", request.call_args.args[1])

    def test_write_shapes(self):
        board = Blackboard()
        with patch.object(board, "_request", return_value=issue(1)) as request:
            board.create_channel(" general ", "Welcome")
            self.assertEqual(request.call_args.args[2], {"title": "💬 general", "body": "Welcome"})
            board.close_channel(1)
            self.assertEqual(request.call_args.args[0], "PATCH")
            self.assertEqual(request.call_args.args[2], {"state": "closed", "state_reason": "not_planned"})

    def test_uncertain_write_is_not_retried(self):
        board = Blackboard()
        with patch.object(board, "_installation_token", return_value="test-token"), patch("blackboard.urlopen", side_effect=URLError("offline")) as http:
            with self.assertRaises(GitHubError) as raised:
                board.send_message(1, "Hello")
            self.assertTrue(raised.exception.uncertain)
            self.assertEqual(http.call_count, 1)

    def test_definite_401_renews_token_once(self):
        board = Blackboard()
        with patch.object(board, "_installation_token", side_effect=["old-token", "new-token"]), patch.object(board, "_http", side_effect=[GitHubError("Expired", status=401), []]) as http:
            self.assertEqual(board.read_messages(1), [])
            self.assertEqual(http.call_count, 2)
            self.assertEqual(http.call_args.args[2], "new-token")

    def test_rate_limit_stops_followup_calls(self):
        board = Blackboard()
        error = HTTPError("https://api.github.com", 429, "Rate limited", {"retry-after": "120"}, io.BytesIO(b'{"message":"Rate limited"}'))
        with patch("blackboard.urlopen", side_effect=error) as http:
            with self.assertRaises(GitHubError):
                board._http("GET", "/example", "test-token")
            self.assertGreater(board._rate_limit_until, time.time() + 100)
            with self.assertRaises(GitHubError):
                board._http("GET", "/example", "test-token")
            self.assertEqual(http.call_count, 1)

    def test_validation_never_makes_a_request(self):
        board = Blackboard()
        with patch.object(board, "_request") as request:
            for operation in [lambda: board.send_message(1, " "), lambda: board.create_channel(" "), lambda: board.read_messages(-1)]:
                with self.assertRaises(ValueError):
                    operation()
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
