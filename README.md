# YouTube Clip Downloader

This is a small local app for downloading a YouTube video and exporting only the section you want, such as `03:00` to `04:00`.

Use this only for videos you own or have permission to download and edit. Downloading content may also be restricted by YouTube's Terms of Service.

## What it does

- Paste a YouTube URL
- Enter a start time and end time
- Choose output quality
- Download the full video temporarily
- Export only the requested clip into the local `downloads` folder

## Requirements

You need these installed and available in your `PATH`:

- `Node.js`
- `yt-dlp`
- `ffmpeg`

## Windows setup

### Install `yt-dlp`

The simplest route is usually:

1. Install Python properly, or download the standalone `yt-dlp.exe`
2. Make sure the folder containing `yt-dlp` is added to your Windows `PATH`
3. Open a new terminal and run:

```powershell
yt-dlp --version
```

### Install `ffmpeg`

1. Install FFmpeg
2. Add the FFmpeg `bin` folder to your Windows `PATH`
3. Open a new terminal and run:

```powershell
ffmpeg -version
```

## Run the app

From this folder:

```powershell
npm start
```

Then open:

```text
http://localhost:3000
```

## Notes

- Accepted time formats: seconds, `mm:ss`, `hh:mm:ss`
- Quality options: `best`, `high` (up to 1080p), `medium` (up to 720p), `low` (up to 480p)
- Output clips are saved in `downloads/`
- The app first tries a fast stream copy clip, then falls back to re-encoding if needed
