import time
import subprocess
import httpx
import os
import sys

API = "http://127.0.0.1:8000"


def test_endpoints():
    print("Starting FastAPI gateway test server...")
    proc = subprocess.Popen(
        [".venv/bin/uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # Wait for server to boot
    time.sleep(3)
    
    try:
        # Check health
        print("Checking GET /health...")
        r = httpx.get(f"{API}/health")
        assert r.status_code == 200, f"Health check failed: {r.status_code}"
        assert r.json()["status"] == "ok"
        print("🟢 Health check passed.")

        # Check connections status
        print("Checking GET /connections...")
        r = httpx.get(f"{API}/connections")
        assert r.status_code == 200, f"Connections failed: {r.status_code}"
        conns = r.json().get("connections", [])
        assert len(conns) > 0, "No connections returned"
        print("🟢 Connections telepathy passed.")
        
        # Check personas list
        print("Checking GET /personas...")
        r = httpx.get(f"{API}/personas")
        assert r.status_code == 200, f"Personas failed: {r.status_code}"
        personas = r.json().get("personas", [])
        assert len(personas) > 0, "No personas loaded"
        assert any(p["name"] == "hermes" for p in personas), "Hermes persona missing"
        print("🟢 Personas loaded successfully.")

        # Check shared context
        print("Checking GET /agent_os/context...")
        r = httpx.get(f"{API}/agent_os/context")
        assert r.status_code == 200
        assert "summary" in r.json()
        print("🟢 Shared context read passed.")

        # Test writing an artifact (Dana White invoice flow)
        print("Triggering POST /agent_os/artifacts (Dana White Invoice test)...")
        dummy_html = "<html><body><h1>Invoice: $50,000 for Dana White</h1></body></html>"
        r = httpx.post(
            f"{API}/agent_os/artifacts",
            json={"filename": "test_dana_white.html", "content": dummy_html}
        )
        assert r.status_code == 200, f"Writing artifact failed: {r.status_code}"
        
        # Verify artifact listed
        print("Checking GET /agent_os/artifacts catalog...")
        r = httpx.get(f"{API}/agent_os/artifacts")
        assert r.status_code == 200
        artifacts = r.json().get("artifacts", [])
        assert any(a["name"] == "test_dana_white.html" for a in artifacts), "Generated artifact missing from list"
        print("🟢 Artifact listed successfully.")

        # Verify artifact preview retrieval
        print("Checking GET /agent_os/artifacts/test_dana_white.html preview...")
        r = httpx.get(f"{API}/agent_os/artifacts/test_dana_white.html")
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        assert r.text == dummy_html
        print("🟢 Artifact preview retrieval passed (Dana White invoice verified).")

        # Clean up artifact file
        artifact_file = os.path.join(".agent_os", "artifacts", "test_dana_white.html")
        if os.path.exists(artifact_file):
            os.remove(artifact_file)
            print("🟢 Cleaned up test artifact.")

        print("\n🎉 ALL GATEWAY API INTEGRATION TESTS PASSED SUCCESSFULLY!")
        sys.exit(0)

    except Exception as e:
        print(f"❌ Test verification failed: {e}")
        # Print server stderr if failed
        sys.exit(1)
        
    finally:
        print("Stopping test server...")
        proc.terminate()
        proc.wait()


if __name__ == "__main__":
    test_endpoints()
