from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import httpx
import os

app = FastAPI()

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

def cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }

@app.options("/api/hunt")
async def options_hunt():
    return JSONResponse(content={}, headers=cors_headers())

@app.post("/api/hunt")
async def hunt(request: Request):
    if not ANTHROPIC_API_KEY:
        return JSONResponse(
            content={"error": "API key non configurata"},
            status_code=500,
            headers=cors_headers()
        )
    body = await request.json()
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
    return JSONResponse(
        content=response.json(),
        headers=cors_headers()
    )

@app.get("/")
def root():
    return JSONResponse(content={"status": "ok"}, headers=cors_headers())
