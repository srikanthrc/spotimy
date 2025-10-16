#!/bin/bash
# Deployment script for Spotimy MCP Server on GCE
# This script sets up the complete infrastructure

set -e

# Configuration variables - UPDATE THESE
PROJECT_ID="${GCP_PROJECT_ID:-modern-bond-473904-e6}"
ZONE="${GCP_ZONE:-us-west1-a}"
REGION="${GCP_REGION:-us-west1}"
INSTANCE_NAME="spotimy-mcp"
MACHINE_TYPE="e2-micro"  # ~$7/month
GITHUB_REPO="https://github.com/srikanthrc/spotimy"
GITHUB_BRANCH="pnsive/sse-oauth"
GITHUB_OWNER="srikanthrc"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Spotimy MCP Server - GCE Deployment ===${NC}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI not found. Please install it first.${NC}"
    echo "https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Prompt for secrets if not set
echo -e "${YELLOW}Please provide your Spotify API credentials:${NC}"
read -p "Spotify Client ID: " SPOTIFY_CLIENT_ID
read -sp "Spotify Client Secret: " SPOTIFY_CLIENT_SECRET
echo ""
read -p "Ngrok Auth Token: " NGROK_AUTH_TOKEN
read -p "Ngrok Domain (e.g., splay.ngrok.dev): " NGROK_DOMAIN
echo ""

# Automatically set SPOTIFY_REDIRECT_URI based on ngrok domain
SPOTIFY_REDIRECT_URI="https://${NGROK_DOMAIN}/callback"
echo -e "${GREEN}Using Spotify Redirect URI: ${SPOTIFY_REDIRECT_URI}${NC}"
echo -e "${YELLOW}⚠️  Make sure this URI is added in your Spotify App settings at:${NC}"
echo -e "${YELLOW}   https://developer.spotify.com/dashboard/applications${NC}"
echo ""

# Set project
echo -e "${YELLOW}Setting GCP project to: ${PROJECT_ID}${NC}"
gcloud config set project ${PROJECT_ID}

# Enable required APIs
echo -e "${YELLOW}Enabling required GCP APIs...${NC}"
gcloud services enable compute.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  secretmanager.googleapis.com

# Create firewall rule for HTTP traffic
echo -e "${YELLOW}Creating firewall rule...${NC}"
gcloud compute firewall-rules create allow-spotimy-http \
  --allow=tcp:3001,tcp:4040 \
  --target-tags=spotimy-server \
  --description="Allow HTTP traffic to Spotimy MCP server" \
  --direction=INGRESS \
  2>/dev/null || echo "Firewall rule already exists"

# Build initial image with Cloud Build from GitHub branch
echo -e "${YELLOW}Building initial Docker image from GitHub (${GITHUB_BRANCH} branch)...${NC}"
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_ZONE=${ZONE} \
  --timeout=20m \
  --async \
  "https://github.com/${GITHUB_OWNER}/spotimy#${GITHUB_BRANCH}" || {
    echo -e "${RED}Initial build failed. This is okay - we'll let the trigger handle it.${NC}"
  }

echo -e "${YELLOW}Waiting 30 seconds for initial build to start...${NC}"
sleep 30

# Create GCE instance with Container-Optimized OS
echo -e "${YELLOW}Creating GCE instance...${NC}"
gcloud compute instances create ${INSTANCE_NAME} \
  --zone=${ZONE} \
  --machine-type=${MACHINE_TYPE} \
  --image-family=cos-stable \
  --image-project=cos-cloud \
  --boot-disk-size=10GB \
  --boot-disk-type=pd-standard \
  --tags=spotimy-server,http-server \
  --metadata=SPOTIFY_CLIENT_ID="${SPOTIFY_CLIENT_ID}",\
SPOTIFY_CLIENT_SECRET="${SPOTIFY_CLIENT_SECRET}",\
SPOTIFY_REDIRECT_URI="${SPOTIFY_REDIRECT_URI}",\
NGROK_AUTH_TOKEN="${NGROK_AUTH_TOKEN}",\
NGROK_DOMAIN="${NGROK_DOMAIN}",\
gce-container-declaration="spec:
  containers:
    - name: spotimy-mcp
      image: gcr.io/${PROJECT_ID}/spotimy-mcp:latest
      env:
        - name: HTTP_HOST
          value: '0.0.0.0'
        - name: HTTP_PORT
          value: '3001'
        - name: SPOTIFY_CLIENT_ID
          value: '${SPOTIFY_CLIENT_ID}'
        - name: SPOTIFY_CLIENT_SECRET
          value: '${SPOTIFY_CLIENT_SECRET}'
        - name: NGROK_AUTH_TOKEN
          value: '${NGROK_AUTH_TOKEN}'
        - name: NGROK_DOMAIN
          value: '${NGROK_DOMAIN}'
        - name: TOKEN_STORE_PATH
          value: '/app/data'
      volumeMounts:
        - name: data
          mountPath: /app/data
  volumes:
    - name: data
      hostPath:
        path: /var/lib/spotimy/data
  restartPolicy: Always
" \
  --metadata-from-file=startup-script=gcp-startup.sh \
  --scopes=cloud-platform \
  --maintenance-policy=MIGRATE

echo -e "${GREEN}✅ Instance created successfully!${NC}"

# Get instance external IP
EXTERNAL_IP=$(gcloud compute instances describe ${INSTANCE_NAME} \
  --zone=${ZONE} \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo -e "${GREEN}=== Instance Information ===${NC}"
echo "Instance Name: ${INSTANCE_NAME}"
echo "Zone: ${ZONE}"
echo "External IP: ${EXTERNAL_IP}"
echo "Ngrok Domain: https://${NGROK_DOMAIN}"
echo ""

# Setup Cloud Build trigger for auto-deployment
echo -e "${YELLOW}Setting up Cloud Build trigger for auto-deployment...${NC}"
gcloud builds triggers create github \
  --name="spotimy-mcp-deploy" \
  --repo-name=spotimy \
  --repo-owner=${GITHUB_OWNER} \
  --branch-pattern="^${GITHUB_BRANCH}$" \
  --build-config=cloudbuild.yaml \
  --substitutions=_ZONE=${ZONE} \
  --description="Auto-deploy Spotimy MCP on push to ${GITHUB_BRANCH}" \
  2>/dev/null || echo "Trigger already exists or failed to create"

echo ""
echo -e "${GREEN}=== Deployment Complete! ===${NC}"
echo ""
echo "🔗 Access your MCP server at:"
echo "   - Direct: http://${EXTERNAL_IP}:3001"
echo "   - Ngrok: https://${NGROK_DOMAIN}"
echo ""
echo "🔍 Health check:"
echo "   curl https://${NGROK_DOMAIN}/health"
echo ""
echo "📊 View logs:"
echo "   gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE} -- docker logs -f spotimy-mcp"
echo ""
echo "🔄 View Cloud Build history:"
echo "   gcloud builds list --limit=5"
echo ""
echo "⚙️  SSH into instance:"
echo "   gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE}"
echo ""
echo -e "${YELLOW}Note: Initial deployment may take 5-10 minutes for the container to build and start.${NC}"
echo -e "${YELLOW}Monitor progress: gcloud builds list --ongoing${NC}"
echo ""
