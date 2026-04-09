# Virtual Cap Try-On (WebRTC Edition) 🧢

A premium, real-time virtual try-on application using **React**, **Python AI (aiortc)**, and **MediaPipe**. This app offloads heavy image processing to a Python server while streaming the results back to a stunning glassmorphic web interface.

##  Key Features
- **Real-Time AI Tracking**: Powered by MediaPipe Tasks API (478 landmarks).
- **Multi-Face Support**: Try on caps with friends simultaneously in a single stream.
- **Posture Guidance**: Built-in HUD provides live feedback (e.g., "Look straight", "Perfect!").
- **Premium UI**: Glassmorphic React interface with dynamic mirroring and cap selection.
- **Dockerized**: Deploy the entire stack with a single command.

##  Getting Started (Docker)

The easiest way to run the project is using **Docker Compose**. This handles all AI dependencies, Python environments, and Node modules for you.

1.  **Clone the Repository**:
    ```bash
    git clone <your-repo-url>
    cd open-cv5
    ```

2.  **Launch the App**:
    ```bash
    docker-compose up --build
    ```

3.  **Access the App**:
    - **Frontend**: `http://localhost:5000`
    - **Backend (API)**: `http://localhost:5025`

## 🚀 Server Deployment

If you are deploying to a remote server, follow these steps:

1.  **Pull Changes**:
    ```bash
    git pull
    ```

2.  **Clean & Restart**:
    Ensure you remove the old Caddy gateway container:
    ```bash
    docker compose down --remove-orphans
    docker compose up -d --build --remove-orphans
    ```

3.  **Firewall Configuration**:
    Open ports **5000** and **5025** on your server's firewall (e.g., `ufw allow 5000` and `ufw allow 5025`).

4.  **⚠️ HTTPS Requirement**:
    Webcam access requires **HTTPS**! Without Caddy/Ngrok, the camera will **only** work on `localhost`. 
    To use it on a public server, you must:
    - Use another reverse proxy (like Nginx) on the server to provide SSL.
    - Or run an `ngrok` tunnel on the server: `ngrok http 5000`.

---

## 🏗️ Architecture
- **Frontend (web-app/)**: React + Vite application on port **5000**.
- **Backend (webrtc_server.py)**: Python AI engine on port **5025**.

## 🛠️ Requirements
- **Docker** & **Docker Compose**
