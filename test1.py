import requests

url = "https://web-production-b1df4.up.railway.app"

data = {
    "voltage": 220,
    "current": 1.5,
    "power": 300,
    "kwh": 0.3,
    "biaya": 500
}

res = requests.post(url, json=data)
print(res.text)