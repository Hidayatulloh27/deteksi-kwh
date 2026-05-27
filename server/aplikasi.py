print("SERVER APP BERJALAN")

from flask import Flask, request, jsonify
import time
import os
import json
import pandas as pd

app = Flask(__name__)

# =========================
# FILE DATA
# =========================
DATA_FILE = "data/data.csv"

# =========================
# BUAT FOLDER DATA
# =========================
os.makedirs("data", exist_ok=True)

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
# BUAT CSV JIKA BELUM ADA
# =========================
if not os.path.exists(DATA_FILE):
    df = pd.DataFrame(columns=[
        "timestamp",
        "voltage",
        "current",
        "power",
        "frequency",
        "pf",
        "kwh",
        "status",
        "relay",
        "pln"
    ])

    df.to_csv(DATA_FILE, index=False)

    print("📁 FILE CSV DIBUAT")


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
# DASHBOARD
# =========================
@app.route('/dashboard')
def dashboard():
    return "<h1>✅ DASHBOARD AKTIF</h1>"


# =========================
# API DATA TERBARU
# =========================
@app.route('/api/latest')
def api_latest():

    global latest_data
    global last_update

    # jika tidak ada data >10 detik
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

    global latest_data
    global last_update

    try:

        print("📡 REQUEST MASUK")

        data = request.get_json()

        print("📦 DATA:", data)

        if not data:
            return jsonify({
                "success": False,
                "error": "No JSON"
            }), 400

        # =========================
        # AMBIL DATA
        # =========================
        latest_data = {
            "voltage": float(data.get("voltage", 0)),
            "current": float(data.get("current", 0)),
            "power": float(data.get("power", 0)),
            "frequency": float(data.get("frequency", 50)),
            "pf": float(data.get("pf", 0)),
            "kwh": float(data.get("kwh", 0)),
            "status": str(data.get("status", "NORMAL")),
            "relay": bool(data.get("relay", True)),
            "pln": bool(data.get("pln", True))
        }

        # =========================
        # UPDATE WAKTU
        # =========================
        last_update = time.time()

        # =========================
        # SIMPAN KE CSV
        # =========================
        row = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "voltage": latest_data["voltage"],
            "current": latest_data["current"],
            "power": latest_data["power"],
            "frequency": latest_data["frequency"],
            "pf": latest_data["pf"],
            "kwh": latest_data["kwh"],
            "status": latest_data["status"],
            "relay": latest_data["relay"],
            "pln": latest_data["pln"]
        }

        print("💾 MENYIMPAN CSV:", row)

        pd.DataFrame([row]).to_csv(
            DATA_FILE,
            mode='a',
            header=False,
            index=False
        )

        print("✅ BERHASIL DISIMPAN")

        return jsonify({
            "success": True,
            "message": "Data updated",
            "data": latest_data
        })

    except Exception as e:

        print("❌ ERROR:", str(e))

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# =========================
# CEK CSV
# =========================
@app.route('/cek_csv')
def cek_csv():

    try:

        if not os.path.exists(DATA_FILE):
            return jsonify({
                "error": "CSV tidak ditemukan"
            })

        df = pd.read_csv(DATA_FILE)

        return df.tail(20).to_json(
            orient="records",
            indent=2
        )

    except Exception as e:

        return jsonify({
            "error": str(e)
        })


# =========================
# HEALTH CHECK
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