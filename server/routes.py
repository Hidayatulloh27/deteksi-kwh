from flask import Blueprint, render_template, jsonify
import pandas as pd
import os

bp = Blueprint('main', __name__)

FILE = "data/data.csv"

# =========================
# HOME
# =========================
@bp.route("/")
def home():
    return render_template("index.html")


# =========================
# API DATA REALTIME
# =========================
@bp.route("/api/latest")
def latest():

    if not os.path.exists(FILE):
        return jsonify({
            "status": "NO_DATA"
        })

    try:
        df = pd.read_csv(FILE)

        if len(df) == 0:
            return jsonify({
                "status": "EMPTY"
            })

        last = df.iloc[-1]

        return jsonify({
            "timestamp": str(last.get("timestamp", "-")),
            "voltage": float(last.get("voltage", 0)),
            "current": float(last.get("current", 0)),
            "power": float(last.get("power", 0)),
            "kwh": float(last.get("kwh", 0)),
            "biaya": float(last.get("biaya", 0)),
            "status": str(last.get("status", "NORMAL")),
            "label": str(last.get("label", "NORMAL"))
        })

    except Exception as e:
        return jsonify({
            "error": str(e)
        })