# PM2 Log Rotation (Production)

Prevents disk exhaustion from API/Web stdout logs.

## Install once per server

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 save
```

## Verify

```bash
pm2 conf pm2-logrotate
ls -lah logs/
```

## Notes

- Application logs are **structured JSON** in production (`NODE_ENV=production`).
- Never ship logs that may contain secrets; the API redacts tokens/passwords.
- Customer WhatsApp message bodies are **not** written to access logs.
