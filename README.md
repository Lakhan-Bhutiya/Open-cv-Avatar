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
    git clone <your-repo-url> ????????????????????????????????????????????????//
    cd open-cv5
    ```

2.  **Launch the App**:
    ```bash
    docker-compose up --build
    ```

3.  **Access & Share (The "No-Flag" Method)**:
    - **One Tunnel to Rule Them All**: Start the app, then run Ngrok to create a secure public link:
    ```bash
    ngrok http 80
    ```
    - **No Browser Setup**: Open the `https://...` link provided by Ngrok. Since it is HTTPS, the camera will work **automatically** on all phones and PCs with zero setup!

---

## 🏗️ Architecture
- **Gateway (Caddy)**: Single entry point (port 80). Routes to Frontend and Backend.
- **Frontend (web-app/)**: React + Vite application.
- **Backend (webrtc_server.py)**: Python AI engine.

## 🛠️ Requirements
- **Docker** & **Docker Compose**
- **Ngrok** (For instant public sharing)

