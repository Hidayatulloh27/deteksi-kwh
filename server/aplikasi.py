print("SERVER APP BERJALAN")

from flask import Flask, request, jsonify
import time
import os
import pandas as pd
from datetime import datetime

app = Flask(__name__)

# =========================
# FILE CSV
# =========================
DATA_DIR = "data"
CSV_FILE = os.path.join(DATA_DIR, "data.csv")

os.makedirs(DATA_DIR, exist_ok=True)

# buat csv jika belum ada
if not os.path.exists(CSV_FILE):
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
    df.to_csv(CSV_FILE, index=False)

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
# HOME
# =========================
@app.route('/')
def home():
    return """
    <h1>⚡ API Monitoring KWH Aktif</h1>

    <p>GET /api/latest</p>
    <p>POST /api/update</p>
    <p>GET /api/csv</p>
    """

# =========================
# DASHBOARD
# =========================
@app.route('/dashboard')
def dashboard():
    return "<h1>DASHBOARD AKTIF</h1>"

# =========================
# API LATEST
# =========================
@app.route('/api/latest')
def api_latest():
    global latest_data, last_update

    if time.time() - last_update > 10:
        return jsonify({
            "status": "OFFLINE"
        })

    return jsonify(latest_data)

# =========================
# API UPDATE
# =========================
@app.route('/api/update', methods=['POST'])
def api_update():
    global latest_data, last_update

    try:
        data = request.json

        print("📥 DATA MASUK:", data)

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

        last_update = time.time()

        # =========================
        # SIMPAN CSV
        # =========================
        row = {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            **latest_data
        }

        print("💾 MENYIMPAN CSV:", row)

        pd.DataFrame([row]).to_csv(
            CSV_FILE,
            mode='a',
            header=not os.path.exists(CSV_FILE),
            index=False
        )

        print("✅ CSV BERHASIL DISIMPAN")

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
@app.route('/api/csv')
def api_csv():

    try:
        df = pd.read_csv(CSV_FILE)

        return df.tail(20).to_json(
            orient='records',
            indent=2
        )

    except Exception as e:
        return jsonify({
            "error": str(e)
        })

# =========================
# HEALTH
# =========================
@app.route('/health')
def health():
    return jsonify({
        "status": "healthy"
    })

# =========================
# RUN
# =========================
if __name__ == '__main__':

    port = int(os.environ.get("PORT", 5000))

    app.run(
        host='0.0.0.0',
        port=port,
        debug=False
    )