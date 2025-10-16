#!/bin/bash
# Helper script to view Spotimy MCP server logs on GCE

ZONE="us-west1-a"
INSTANCE="spotimy-mcp"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Spotimy MCP Server Logs ===${NC}"
echo ""
echo "Available commands:"
echo "  ./gce-logs.sh follow          - Follow logs in real-time"
echo "  ./gce-logs.sh tail [N]        - Show last N lines (default: 100)"
echo "  ./gce-logs.sh errors          - Show only errors"
echo "  ./gce-logs.sh auth            - Show auth/OAuth logs"
echo "  ./gce-logs.sh ngrok           - Show ngrok tunnel logs"
echo "  ./gce-logs.sh startup         - Show startup script logs"
echo "  ./gce-logs.sh serial          - Show serial console output"
echo ""

case "$1" in
  follow)
    echo -e "${YELLOW}Following logs (Ctrl+C to stop)...${NC}"
    gcloud compute ssh ${INSTANCE} --zone=${ZONE} --command="docker ps --format '{{.Names}}' | head -1 | xargs docker logs -f"
    ;;

  tail)
    LINES=${2:-100}
    echo -e "${YELLOW}Last ${LINES} lines:${NC}"
    gcloud compute ssh ${INSTANCE} --zone=${ZONE} --command="docker ps --format '{{.Names}}' | head -1 | xargs docker logs --tail ${LINES}"
    ;;

  errors)
    echo -e "${YELLOW}Filtering errors and warnings...${NC}"
    gcloud compute ssh ${INSTANCE} --zone=${ZONE} --command="docker ps --format '{{.Names}}' | head -1 | xargs docker logs | grep -iE '(error|warning|fail)'" 2>&1 | grep -v "Warning: Permanently added"
    ;;

  auth)
    echo -e "${YELLOW}Auth/OAuth related logs...${NC}"
    gcloud compute ssh ${INSTANCE} --zone=${ZONE} --command="docker ps --format '{{.Names}}' | head -1 | xargs docker logs | grep -iE '(auth|token|session|oauth|spotify)'" 2>&1 | grep -v "Warning: Permanently added"
    ;;

  ngrok)
    echo -e "${YELLOW}Ngrok tunnel logs...${NC}"
    gcloud compute ssh ${INSTANCE} --zone=${ZONE} --command="docker ps --format '{{.Names}}' | head -1 | xargs docker logs | grep -i ngrok" 2>&1 | grep -v "Warning: Permanently added"
    ;;

  startup)
    echo -e "${YELLOW}Startup script logs...${NC}"
    gcloud compute ssh ${INSTANCE} --zone=${ZONE} --command="sudo journalctl -u google-startup-scripts.service --no-pager" 2>&1 | grep -v "Warning: Permanently added"
    ;;

  serial)
    echo -e "${YELLOW}Serial console output (last 100 lines)...${NC}"
    gcloud compute instances get-serial-port-output ${INSTANCE} --zone=${ZONE} | tail -100
    ;;

  *)
    # Default: show last 50 lines
    echo -e "${YELLOW}Last 50 lines (use 'tail N' for more):${NC}"
    gcloud compute ssh ${INSTANCE} --zone=${ZONE} --command="docker ps --format '{{.Names}}' | head -1 | xargs docker logs --tail 50" 2>&1 | grep -v "Warning: Permanently added"
    ;;
esac
