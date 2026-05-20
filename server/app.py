print("SERVER APP BERJALAN")
from flask import Flask, render_template, request, jsonify
import time
import os

app = Flask(__name__)

# =========================
# WAKTU TERAKHIR DATA
# =========================
last_update = 0

# =========================
# DATA REALTIME
# =========================
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

# =========================
# HALAMAN UTAMA
# =========================
@app.route('/')
def home():
    return """
    <h1>⚡ API Monitoring KWH Aktif</h1>

    <h3>Endpoint:</h3>

    <p>GET /api/latest</p>
    <p>POST /api/update</p>

    <h3>Status Server:</h3>
    <p>ONLINE</p>
    """


# =========================
# HALAMAN DASHBOARD
# =========================
@app.route('/dashboard')
def dashboard():
    return render_template('index.html')


# =========================
# API DATA TERBARU
# =========================
@app.route('/api/latest')
def api_latest():
    global latest_data, last_update

    # jika lebih dari 10 detik tidak ada data
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


# =========================
# API UPDATE DARI ESP32
# =========================
@app.route('/api/update', methods=['POST'])
def api_update():
    global latest_data, last_update

    try:
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
            "message": "Data updated",
            "data": latest_data
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# =========================
# HEALTH CHECK RAILWAY
# =========================
@app.route('/health')
def health():
    return jsonify({
        "status": "healthy"
    })


# =========================
# RUN FLASK
# =========================
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))

    app.run(
        host='0.0.0.0',
        port=port,
        debug=False
    )