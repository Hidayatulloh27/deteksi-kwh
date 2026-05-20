from flask import Flask, render_template, request, jsonify
import time

app = Flask(__name__)

# waktu terakhir data diterima
last_update = 0

# data realtime
latest_data = {
    "voltage": 0,
    "current": 0,
    "power": 0,
    "frequency": 0,
    "pf": 0,
    "kwh": 0,
    "status": "OFFLINE",
    "relay": False,
    "pln": False
}

# halaman website
@app.route('/')
def home():
    return render_template('index.html')


# API dibaca website
@app.route('/api/latest')
def api_latest():
    global latest_data, last_update

    # kalau >10 detik tidak ada data → offline
    if time.time() - last_update > 10:
        return jsonify({
            "voltage": 0,
            "current": 0,
            "power": 0,
            "frequency": 0,
            "pf": 0,
            "kwh": 0,
            "status": "OFFLINE",
            "relay": False,
            "pln": False
        })

    return jsonify(latest_data)


# API dikirim ESP32
@app.route('/api/update', methods=['POST'])
def api_update():
    global latest_data, last_update

    data = request.json

    latest_data = {
        "voltage": data.get("voltage", 0),
        "current": data.get("current", 0),
        "power": data.get("power", 0),
        "frequency": data.get("frequency", 50),
        "pf": data.get("pf", 0),
        "kwh": data.get("kwh", 0),
        "status": data.get("status", "NORMAL"),
        "relay": data.get("relay", True),
        "pln": data.get("pln", True)
    }

    # simpan waktu terakhir data masuk
    last_update = time.time()

    return jsonify({
        "success": True,
        "message": "Data updated"
    })


if __name__ == '__main__':
    app.run(debug=True)