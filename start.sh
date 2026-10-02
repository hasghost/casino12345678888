#!/bin/bash

source ~/.nvm/nvm.sh
cd /home/container

echo "Starting SpindBet Mini App..."
PORT=25809 NODE_ENV=production npm start &
MINIAPP_PID=$!

echo "Starting SpindBet Bot..."
python3 main.py &
BOT_PID=$!

wait -n $MINIAPP_PID $BOT_PID

echo "One of the processes stopped."
exit 1