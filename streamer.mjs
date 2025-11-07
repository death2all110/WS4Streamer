import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import path from 'path';
import fs from 'fs';

// --- Configuration ---
const WS4KP_URL = process.env.WS4KP_URL || 'http://127.0.0.1:8080/?kiosk=true&settings-mediaPlaying-boolean=true';
const HLS_DIR = path.resolve(process.env.HLS_DIR || './hls');
const MUSIC_DIR = path.resolve(process.env.MUSIC_DIR || './music');
const AUDIO_LIST_FILE = path.resolve('./audio_list.txt');

const WIDTH = parseInt(process.env.WIDTH) || 640;
const HEIGHT = parseInt(process.env.HEIGHT) || 480;
const FPS = parseInt(process.env.FPS) || 25;
const VIDEO_BITRATE = process.env.VIDEO_BITRATE || '2000k';
const AUDIO_BITRATE = process.env.AUDIO_BITRATE || '128k';
const HLS_SEGMENT_TIME = parseInt(process.env.HLS_SEGMENT_TIME) || 2;

/**
 * Scans the MUSIC_DIR for mp3 files and generates an 'audio_list.txt'.
 * If no files are found, it logs an error and returns null.
 * @returns {object|null} FFmpeg input arguments or null on failure.
 */
function getAudioInput() {
    console.log(`[Audio] Scanning for music in: ${MUSIC_DIR}`);
    let files = [];
    try {
        fs.mkdirSync(MUSIC_DIR, { recursive: true });
        files = fs.readdirSync(MUSIC_DIR).filter(file => file.toLowerCase().endsWith('.mp3'));
    } catch (err) {
        console.error(`[Audio] CRITICAL: Could not read music directory: ${err.message}`);
        return null;
    }

    if (files.length > 0) {
        console.log(`[Audio] Found ${files.length} track(s).`);
        const audioList = files
            .map(file => `file '${path.join(MUSIC_DIR, file)}'`)
            .join('\n');

        fs.writeFileSync(AUDIO_LIST_FILE, audioList);

        return {
            input: AUDIO_LIST_FILE,
            options: ['-f', 'concat', '-safe', '0', '-stream_loop', '-1']
        };
    }

    console.error(`[Audio] CRITICAL: No .mp3 files were found in ${MUSIC_DIR}.`);
    console.error('[Audio] Audio fallback is disabled. The streamer will not start.');
    return null;
}


async function startStream() {
    let audio;
    let browser;
    let ffmpeg;

    try {
        console.log(`[Streamer] Starting...`);
        console.log(`[Streamer] Target URL: ${WS4KP_URL}`);
        console.log(`[Streamer] HLS Output Dir: ${HLS_DIR}`);

        fs.mkdirSync(HLS_DIR, { recursive: true });

        audio = getAudioInput();

        if (!audio) {
            console.error('[Streamer] Halting due to missing audio. Please add .mp3 files to the music directory.');
            process.exit(1); 
        }

        const ffmpegArgs = [
            '-loglevel', 'error',
            '-f', 'image2pipe',
            '-framerate', `${FPS}`,
            '-s', `${WIDTH}x${HEIGHT}`,
            '-i', 'pipe:0',

            ...audio.options,
            '-i', audio.input,

            '-filter_complex', '[0:v]scale=1280:720,format=yuv420p[v];[1:a]volume=0.5[a]',

            '-map', '[v]',
            '-map', '[a]',

            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-b:v', VIDEO_BITRATE,
            '-g', `${FPS * HLS_SEGMENT_TIME}`,

            '-c:a', 'aac',
            '-b:a', AUDIO_BITRATE,

            '-f', 'hls',
            '-hls_time', `${HLS_SEGMENT_TIME}`,
            '-hls_list_size', '5',
            '-hls_flags', 'delete_segments',
            path.join(HLS_DIR, 'stream.m3u8')
        ];

        console.log(`[FFmpeg] Spawning: ${ffmpegPath} ${ffmpegArgs.join(' ')}`);
        ffmpeg = spawn(ffmpegPath, ffmpegArgs);

        ffmpeg.stderr.on('data', (data) => {
            console.error(`[FFmpeg Error]: ${data.toString()}`);
        });

        ffmpeg.on('close', (code) => {
            console.log(`[FFmpeg] Process exited with code ${code}`);
            process.exit(1);
        });

        console.log('[Puppeteer] Launching browser...');
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--autoplay-policy=no-user-gesture-required',
                `--window-size=${WIDTH},${HEIGHT}`
            ],
            defaultViewport: { width: WIDTH, height: HEIGHT }
        });

        const page = await browser.newPage();
        await page.setViewport({ width: WIDTH, height: HEIGHT });

        console.log(`[Puppeteer] Navigating to ${WS4KP_URL}...`);
        await page.goto(WS4KP_URL, { waitUntil: 'networkidle0' });
        console.log('[Puppeteer] Page loaded.');

        const cdp = await page.target().createCDPSession();

        await cdp.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 85,
        });
        console.log('[CDP] Screencast started.');

        cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
            try {
                const frame = Buffer.from(data, 'base64');

                ffmpeg.stdin.write(frame, (err) => {
                    if (err) {
                        console.error('[Streamer] Error writing to FFmpeg stdin:', err.message);
                    }
                });

                await cdp.send('Page.screencastFrameAck', { sessionId });
            } catch (e) {
                console.error('[CDP] Error processing frame:', e.message);
            }
        });

    } catch (err) {
        console.error('[Streamer] A critical error occurred:');
        console.error(err);

        if (browser) await browser.close();
        if (ffmpeg) ffmpeg.kill();
        process.exit(1);
    }
}

startStream();