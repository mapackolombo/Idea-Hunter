from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In produzione: metti il tuo dominio Vercel
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

@app.post("/api/hunt")
async def hunt(request: Request):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="API key non configurata")

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

    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return response.json()

@app.get("/")
def root():
    return {"status": "ok"}
