# WS4KP Live Streamer

This project turns a running WeatherStar 4000+ (`ws4kp`) instance into a 24/7 live-streaming HLS feed, complete with a dynamic background music playlist. It's designed to be a lightweight, efficient, and robust IPTV source for applications like Plex, Jellyfin, Channels DVR, or any HLS-compatible player.

It uses a highly efficient method to capture the browser, piping frames directly from the **Chrome DevTools Protocol (CDP)** into FFmpeg. This avoids the high overhead and inefficiency of screenshot-based methods.

## Features

* **High-Efficiency Capture:** Uses Puppeteer's CDP `Page.startScreencast` for low-overhead video capture directly from the browser's renderer.
* **Dynamic Audio Playlist:** Automatically scans a local `music` directory for `.mp3` files and uses FFmpeg's `concat` demuxer to create a seamless, looping playlist.
* **IPTV Ready:** Serves a standard `/playlist.m3u` file for easy client discovery.
* **EPG/Guide Data:** Generates a 24-hour `/guide.xml` (XMLTV) file with synthetic "Local Forecast" programming.
* **Robust:** Will not start if the `music` directory is empty, preventing a silent stream.
* **Fully Containerized:** Includes a `Dockerfile` for easy, one-step deployment.

## How It Works

This project is a small, self-contained application comprised of two main scripts that are run concurrently:

1.  **`streamer.mjs` (The Engine):**
    * Launches a headless Puppeteer (Chrome) instance.
    * Navigates to your `ws4kp` URL (which you provide).
    * Scans the `./music` directory and generates an `audio_list.txt` for FFmpeg.
    * Spawns an FFmpeg process.
    * Connects to the Chrome DevTools Protocol and starts a `Page.startScreencast`.
    * **Pipes** the JPEG video frames from CDP directly to FFmpeg's `stdin`.
    * Tells FFmpeg to use the `audio_list.txt` as the looping audio input.
    * FFmpeg muxes (combines) the video and audio and encodes them into a live HLS stream in the `./hls` directory.

2.  **`server.mjs` (The Frontend):**
    * Starts a simple Express web server.
    * Serves the static HLS files (e.g., `stream.m3u8` and `stream.ts`) from the `./hls` directory.
    * Serves the generated IPTV playlist at `/playlist.m3u`.
    * Serves the generated XMLTV guide data at `/guide.xml`.

---

## 🚀 Quick Start (Docker)

This is the recommended way to run the project.

### 1. Project Setup

Create a new directory (e.g., `ws4kp-streamer`) and place the five files from this project (`package.json`, `streamer.mjs`, `server.mjs`, `Dockerfile`, `.dockerignore`) inside it.

### 2. Add Your Music

Create a folder named `music` in the same directory and place at least one `.mp3` file inside it. The streamer **will not start** if this folder is empty.

### 3. Prepare Your `ws4kp` Instance

This container needs to connect to a `ws4kp` instance. To prevent serving stale data, it's highly recommended to run your `ws4kp` in a mode that disables its caching proxy.

Based on the `ws4kp` `README.md`, you can do this by running:
```
bash
STATIC=1 npm start
```
This will start `ws4kp` on port 8080 without its caching proxy.

### 4. Build the Docker Image

Open a terminal in your project directory and run:
Bash

`docker build -t ws4kp-streamer .`

### 5. Run the Container

You must provide two environment variables (-e) and one volume mount (-v) to the container.

    Find your Host IP: Find the local IP address of the computer running Docker (e.g., 192.168.1.100).

    Get your Music Path: Get the full, absolute path to your music folder (e.g., /server/music).

Now, run the container:
```
# --- REPLACE VALUES BELOW ---
HOST_IP="192.168.1.100"
FULL_MUSIC_PATH="/server/music"
# ----------------------------

docker run -d --name ws-streamer -p 8000:8000 \
  -e "BASE_URL=http://${HOST_IP}:8000" \
  -e "WS4KP_URL=http://${HOST_IP}:8080/?kiosk=true&settings-mediaPlaying-boolean=true" \
  -v "${FULL_MUSIC_PATH}:/home/pptruser/app/music" \
  ws4kp-streamer
```
### Environment Variables
| Variable | Description | Default |
| :--- | :--- | :--- |
| **`BASE_URL`** | **(Required)** The full public URL of this container, used for the IPTV playlist. | `http://127.0.0.1:8000` |
| **`WS4KP_URL`** | **(Required)** The full URL to your `ws4kp` instance. **Must** include `?kiosk=true`. | `http://127.0.0.1:8080/?kiosk=true&settings-mediaPlaying-boolean=true` |
| `HTTP_PORT` | The internal port for the web server. | `8000` |
| `CHANNEL_NUMBER` | The channel number for the IPTV stream. | `1234` |
| `WIDTH` | Video width for the stream. | `1280` |
| `HEIGHT` | Video height for the stream. | `720` |
| `FPS` | Frames per second for the output stream. | `10` |
| `VIDEO_BITRATE` | The output video bitrate. | `2000k` |
| `AUDIO_BITRATE` | The output audio bitrate. | `128k` |
| `HLS_SEGMENT_TIME`| Duration (in seconds) of each HLS video segment. | `2` |

### 6. Adding to Your IPTV Client (Plex, Jellyfin, etc.)

Once the container is running, open your IPTV client's "Live TV & DVR" settings and add a new M3U source. Use the URLs from your server (replacing 192.168.1.100 with your host IP).

    M3U Playlist URL: http://192.168.1.100:8000/playlist.m3u

    XMLTV Guide URL: http://192.168.1.100:8000/guide.xml

Your client will load the M3U, find the "WeatherStar 4000+" channel, and download the guide data. You can now tune in to your 24/7 weather stream.