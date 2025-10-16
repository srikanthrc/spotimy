# GCP Deployment Guide - Spotimy MCP Server

This guide explains how to deploy the Spotimy MCP Server on Google Compute Engine (GCE) with automatic CI/CD from GitHub.

## Overview

This deployment setup provides:
- ✅ **No timeout limits** - Perfect for long-lived SSE connections
- ✅ **Auto-deployment** - Push to `pnsive/sse-oauth` branch triggers automatic rebuild and deployment
- ✅ **Cost-effective** - ~$7-10/month on e2-micro instance
- ✅ **Persistent storage** - SQLite database persists across restarts
- ✅ **Ngrok tunnel** - Public HTTPS access via your custom domain

## Architecture

```
GitHub (pnsive/sse-oauth branch)
    ↓ (git push)
Cloud Build Trigger
    ↓ (builds Docker image)
Container Registry (gcr.io)
    ↓ (pulls image)
GCE Instance (Container-Optimized OS)
    ↓ (runs container)
Spotimy MCP Server + Ngrok Tunnel
```

## Prerequisites

1. **Google Cloud Platform Account**
   - Active GCP project
   - Billing enabled

2. **gcloud CLI** installed
   ```bash
   # Install gcloud CLI
   # https://cloud.google.com/sdk/docs/install

   # Authenticate
   gcloud auth login
   ```

3. **GitHub Repository Access**
   - Repository: `https://github.com/srikanthrc/spotimy`
   - Branch: `pnsive/sse-oauth`

4. **Spotify API Credentials**
   - Client ID
   - Client Secret
   - Redirect URI configured: `http://127.0.0.1:3001/callback`

5. **Ngrok Account**
   - Auth token
   - Custom domain (e.g., `splay.ngrok.dev`)

## Deployment Steps

### 1. Configure Environment Variables

Edit [gce-deploy.sh](gce-deploy.sh) and update these variables:

```bash
PROJECT_ID="your-gcp-project-id"      # Your GCP project ID
ZONE="us-central1-a"                   # GCP zone
REGION="us-central1"                   # GCP region
```

### 2. Run Deployment Script

```bash
# Make script executable (already done)
chmod +x gce-deploy.sh

# Run deployment
./gce-deploy.sh
```

The script will prompt you for:
- Spotify Client ID
- Spotify Client Secret
- Ngrok Auth Token
- Ngrok Domain

### 3. What the Script Does

1. **Enables GCP APIs**
   - Compute Engine API
   - Cloud Build API
   - Container Registry API
   - Secret Manager API

2. **Creates Firewall Rules**
   - Opens ports 3001 (MCP server)
   - Opens port 4040 (Ngrok web interface)

3. **Builds Docker Image**
   - Triggers Cloud Build from GitHub branch
   - Pushes image to Container Registry

4. **Creates GCE Instance**
   - Container-Optimized OS
   - e2-micro machine type (~$7/month)
   - 10GB boot disk
   - Auto-restart on failure

5. **Sets Up Cloud Build Trigger**
   - Auto-deploys on push to `pnsive/sse-oauth` branch
   - Rebuilds image and updates instance

### 4. Verify Deployment

```bash
# Check instance status
gcloud compute instances list

# Get instance IP
gcloud compute instances describe spotimy-mcp \
  --zone=us-central1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'

# View logs
gcloud compute ssh spotimy-mcp --zone=us-central1-a -- docker logs -f spotimy-mcp

# Check health
curl https://splay.ngrok.dev/health
```

## CI/CD Workflow

### Automatic Deployment on Git Push

1. Make changes to your code
2. Commit and push to `pnsive/sse-oauth` branch:
   ```bash
   git add .
   git commit -m "feat: update MCP server"
   git push origin pnsive/sse-oauth
   ```
3. Cloud Build automatically:
   - Builds new Docker image
   - Pushes to Container Registry
   - Updates GCE instance
   - Restarts container

### Monitor Build Progress

```bash
# View ongoing builds
gcloud builds list --ongoing

# View recent builds
gcloud builds list --limit=5

# Stream build logs
gcloud builds log <BUILD_ID> --stream
```

## Manual Operations

### SSH into Instance

```bash
gcloud compute ssh spotimy-mcp --zone=us-central1-a
```

### View Container Logs

```bash
# Real-time logs
gcloud compute ssh spotimy-mcp --zone=us-central1-a -- docker logs -f spotimy-mcp

# Last 100 lines
gcloud compute ssh spotimy-mcp --zone=us-central1-a -- docker logs --tail 100 spotimy-mcp
```

### Restart Container

```bash
gcloud compute ssh spotimy-mcp --zone=us-central1-a -- docker restart spotimy-mcp
```

### Update Environment Variables

```bash
# Update instance metadata
gcloud compute instances add-metadata spotimy-mcp \
  --zone=us-central1-a \
  --metadata=SPOTIFY_CLIENT_ID="new_value"

# Restart instance to apply
gcloud compute instances reset spotimy-mcp --zone=us-central1-a
```

### Manual Image Update

```bash
# SSH into instance
gcloud compute ssh spotimy-mcp --zone=us-central1-a

# On the instance
docker pull gcr.io/YOUR_PROJECT_ID/spotimy-mcp:latest
docker stop spotimy-mcp
docker rm spotimy-mcp
bash /var/run/google.startup.script
```

## Endpoints

Once deployed, your MCP server is accessible at:

### Via Ngrok (Recommended)
- **Base URL**: `https://splay.ngrok.dev`
- **Health Check**: `https://splay.ngrok.dev/health`
- **MCP Endpoint**: `https://splay.ngrok.dev/mcp`
- **Auth Flow**: `https://splay.ngrok.dev/auth?sessionId=<id>`

### Direct IP Access
- **Base URL**: `http://<EXTERNAL_IP>:3001`
- **Health Check**: `http://<EXTERNAL_IP>:3001/health`

## Cost Estimate

### Monthly Costs (e2-micro in us-central1)
- **Compute**: ~$7.11/month (730 hours)
- **Storage**: ~$0.40/month (10GB standard disk)
- **Egress**: ~$1-2/month (depends on usage)
- **Total**: **~$8-10/month**

### Optional Cost Optimizations
- Use preemptible instances: ~$2.13/month (may shut down every 24h)
- Use e2-small for better performance: ~$14/month
- Use committed use discounts: 30% savings

## Troubleshooting

### Instance Not Starting

```bash
# Check instance serial port output
gcloud compute instances get-serial-port-output spotimy-mcp \
  --zone=us-central1-a

# Check startup script logs
gcloud compute ssh spotimy-mcp --zone=us-central1-a -- sudo journalctl -u google-startup-scripts.service
```

### Container Failing to Start

```bash
# SSH into instance
gcloud compute ssh spotimy-mcp --zone=us-central1-a

# Check Docker logs
docker logs spotimy-mcp

# Check if image exists
docker images | grep spotimy

# Manually pull image
docker pull gcr.io/YOUR_PROJECT_ID/spotimy-mcp:latest
```

### Cloud Build Failing

```bash
# List recent builds with status
gcloud builds list --limit=10

# Get detailed build log
gcloud builds log <BUILD_ID>

# Manually trigger build
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_ZONE=us-central1-a \
  https://github.com/srikanthrc/spotimy#pnsive/sse-oauth
```

### Ngrok Not Connecting

```bash
# SSH and check ngrok status
gcloud compute ssh spotimy-mcp --zone=us-central1-a

# Check ngrok API
curl http://localhost:4040/api/tunnels

# View container logs for ngrok errors
docker logs spotimy-mcp | grep -i ngrok

# Verify auth token
docker exec spotimy-mcp env | grep NGROK
```

### Firewall Issues

```bash
# Check firewall rules
gcloud compute firewall-rules list --filter="name:spotimy"

# Verify instance tags
gcloud compute instances describe spotimy-mcp \
  --zone=us-central1-a \
  --format='get(tags.items)'

# Test connectivity
curl -v http://<EXTERNAL_IP>:3001/health
```

## Cleanup

To delete all resources:

```bash
# Delete Cloud Build trigger
gcloud builds triggers delete spotimy-mcp-deploy

# Delete GCE instance
gcloud compute instances delete spotimy-mcp --zone=us-central1-a

# Delete firewall rule
gcloud compute firewall-rules delete allow-spotimy-http

# Delete Docker images (optional)
gcloud container images delete gcr.io/YOUR_PROJECT_ID/spotimy-mcp:latest
```

## Security Best Practices

### 1. Use Secret Manager (Recommended)

Instead of storing secrets in instance metadata:

```bash
# Store secrets in Secret Manager
echo -n "your-client-secret" | gcloud secrets create spotify-client-secret --data-file=-

# Grant instance access
gcloud secrets add-iam-policy-binding spotify-client-secret \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"

# Update startup script to fetch from Secret Manager
```

### 2. Restrict Firewall Rules

```bash
# Only allow specific IP ranges
gcloud compute firewall-rules update allow-spotimy-http \
  --source-ranges="YOUR_IP_RANGE/32"
```

### 3. Enable OS Login

```bash
gcloud compute instances add-metadata spotimy-mcp \
  --zone=us-central1-a \
  --metadata enable-oslogin=TRUE
```

## Support

- **GitHub Issues**: https://github.com/srikanthrc/spotimy/issues
- **GCP Documentation**: https://cloud.google.com/compute/docs
- **MCP Specification**: https://github.com/modelcontextprotocol/specification

## Next Steps

1. ✅ Deploy instance with `./gce-deploy.sh`
2. ✅ Verify health at `https://splay.ngrok.dev/health`
3. ✅ Test OAuth flow at `https://splay.ngrok.dev/auth?sessionId=test`
4. ✅ Connect MCP client to `https://splay.ngrok.dev/mcp`
5. ✅ Push code changes to auto-deploy

Happy deploying! 🚀
