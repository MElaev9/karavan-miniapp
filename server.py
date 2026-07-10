import os

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

app = FastAPI()

API_BASE_URL = os.environ.get("API_BASE_URL", "")


@app.get("/config.js")
def config_js():
    return Response(
        content=f'window.APP_CONFIG = {{"API_BASE_URL": "{API_BASE_URL}"}};',
        media_type="application/javascript",
    )


@app.get("/")
def index():
    return FileResponse("public/index.html")


app.mount("/", StaticFiles(directory="public", html=True), name="static")
