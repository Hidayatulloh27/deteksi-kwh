import requests

url = "https://web-production-b1df4.up.railway.app"

data = {
    "voltage": 220,
    "current": 3,
    "power": 700,
    "kwh": 1,
    "biaya": 1500
}

try:
    res = requests.post(url, json=data, timeout=10)

    print("STATUS:", res.status_code)
    print("RESPON:", res.text)

except requests.exceptions.Timeout:
    print("❌ Timeout (server lama respon)")

except requests.exceptions.ConnectionError:
    print("❌ Tidak bisa connect ke server")

except Exception as e:
    print("❌ ERROR:", e)