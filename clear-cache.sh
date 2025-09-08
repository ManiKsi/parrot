#!/bin/bash

# Clear Cache Script for Interview Coder
# This script clears corrupted cache directories that can cause Electron issues

echo "🧹 Clearing Interview Coder cache directories..."

# Define the app data path
APP_DATA_PATH="$HOME/Library/Application Support/interview-coder-v1"
SESSION_PATH="$APP_DATA_PATH/session"

# Cache directories that commonly get corrupted
CACHE_DIRS=(
    "$SESSION_PATH/Shared Dictionary"
    "$SESSION_PATH/Cache"
    "$SESSION_PATH/GPUCache"
    "$SESSION_PATH/Local Storage"
    "$SESSION_PATH/Session Storage"
)

# Remove cache directories
for cache_dir in "${CACHE_DIRS[@]}"; do
    if [ -d "$cache_dir" ]; then
        echo "🗑️  Removing: $cache_dir"
        rm -rf "$cache_dir"
    else
        echo "✅ Already clean: $cache_dir"
    fi
done

echo "✨ Cache cleanup complete!"
echo "💡 You can now restart the Interview Coder application."