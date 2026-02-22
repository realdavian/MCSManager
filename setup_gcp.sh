#!/bin/bash
# -------------------------------------------------------------------------
# GCP Provisioning & Management Script
# Merged from previous mc-server-manager.sh + Artifact Registry Setup
# -------------------------------------------------------------------------

set -e

# Load environment variables
if [ -f .env ]; then
  source .env
else
  echo "Error: .env file not found. Please create one with GCP_PROJECT_ID, REGION, and ZONE."
  exit 1
fi

# Validate required variables
if [ -z "$GCP_PROJECT_ID" ] || [ -z "$REGION" ] || [ -z "$ZONE" ]; then
  echo "Error: GCP_PROJECT_ID, REGION, and ZONE must be set in .env"
  exit 1
fi

# Configuration
VM_NAME="minecraft-host"
MACHINE_TYPE="e2-standard-4"
REPO_NAME="mcsmanager-repo"
SA_NAME="github-actions-deploy"
SA_EMAIL="${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
FIREWALL_RULE_NAME="allow-mcsmanager"
GH_REPO_NAME="realdavian/MCSManager"

# Ensure gcloud is configured with the correct project
gcloud config set project "$GCP_PROJECT_ID"

# ==============================================================================
# 1. SETUP COMMAND (Run Once for full infrastructure)
# ==============================================================================
function setup_infrastructure() {
    echo "============================================================"
    echo "Starting GCP Provisioning for project: $GCP_PROJECT_ID"
    echo "============================================================"

    # 1. Enable Required APIs
    echo -e "\n[1/6] Enabling required GCP APIs..."
    gcloud services enable \
        compute.googleapis.com \
        artifactregistry.googleapis.com \
        iam.googleapis.com \
        iamcredentials.googleapis.com

    # 2. Create Artifact Registry
    echo -e "\n[2/6] Checking Artifact Registry ($REPO_NAME)..."
    if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" &>/dev/null; then
        gcloud artifacts repositories create "$REPO_NAME" \
            --repository-format=docker \
            --location="$REGION" \
            --description="Docker repository for MCSManager"
        echo "✅ Repository created."
    else
        echo "✅ Repository $REPO_NAME already exists."
    fi

    # 3. Create Service Account & Assign Role
    echo -e "\n[3/6] Checking Service Account ($SA_NAME)..."
    if ! gcloud iam service-accounts describe "$SA_EMAIL" &>/dev/null; then
        gcloud iam service-accounts create "$SA_NAME" \
            --description="Service account for GitHub Actions CI/CD" \
            --display-name="GitHub Actions Deployer"
        sleep 5 # Give time for SA to propagate

        # 3.1. Grant permission to write and read from Artifact Registry
        if ! gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten="bindings[].members" --format="table(bindings.role)" --filter="bindings.members:serviceAccount:$SA_EMAIL" | grep -q "roles/artifactregistry.writer"; then
            gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
                --member="serviceAccount:$SA_EMAIL" \
                --role="roles/artifactregistry.writer" >/dev/null
        fi
        if ! gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten="bindings[].members" --format="table(bindings.role)" --filter="bindings.members:serviceAccount:$SA_EMAIL" | grep -q "roles/artifactregistry.reader"; then
            gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
                --member="serviceAccount:$SA_EMAIL" \
                --role="roles/artifactregistry.reader" >/dev/null
        fi
        
        # 3.2. Grant permission to describe and start Compute Engine instances
        if ! gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten="bindings[].members" --format="table(bindings.role)" --filter="bindings.members:serviceAccount:$SA_EMAIL" | grep -q "roles/compute.instanceAdmin.v1"; then
            gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
                --member="serviceAccount:$SA_EMAIL" \
                --role="roles/compute.instanceAdmin.v1" >/dev/null
        fi
        echo "✅ Service account created & roles assigned."
    else
        echo "✅ Service Account $SA_EMAIL already exists."
        # Ensure roles are assigned if SA already exists but roles might be missing
        if ! gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten="bindings[].members" --format="table(bindings.role)" --filter="bindings.members:serviceAccount:$SA_EMAIL" | grep -q "roles/artifactregistry.reader"; then
            echo "   Assigning roles/artifactregistry.reader to existing SA..."
            gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
                --member="serviceAccount:$SA_EMAIL" \
                --role="roles/artifactregistry.reader" >/dev/null
        fi
        if ! gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten="bindings[].members" --format="table(bindings.role)" --filter="bindings.members:serviceAccount:$SA_EMAIL" | grep -q "roles/compute.instanceAdmin.v1"; then
            echo "   Assigning roles/compute.instanceAdmin.v1 to existing SA..."
            gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
                --member="serviceAccount:$SA_EMAIL" \
                --role="roles/compute.instanceAdmin.v1" >/dev/null
        fi
    fi

    # 4. Setup Workload Identity Federation (Instead of JSON Key)
    echo -e "\n[4/6] Configuring Workload Identity Federation for GitHub Actions..."
    PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT_ID" --format="value(projectNumber)")
    
    # 4a. Create Pool
    if ! gcloud iam workload-identity-pools describe "github-actions-pool" --location="global" &>/dev/null; then
        gcloud iam workload-identity-pools create "github-actions-pool" \
            --location="global" \
            --display-name="GitHub Actions Pool" \
            --description="Pool for GitHub Actions IAM" >/dev/null
    fi

    # 4b. Create Provider
    if ! gcloud iam workload-identity-pools providers describe "github-actions-provider" --workload-identity-pool="github-actions-pool" --location="global" &>/dev/null; then
        gcloud iam workload-identity-pools providers create-oidc "github-actions-provider" \
            --location="global" \
            --workload-identity-pool="github-actions-pool" \
            --display-name="GitHub Actions Provider" \
            --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
            --attribute-condition="assertion.repository == '${GH_REPO_NAME}'" \
            --issuer-uri="https://token.actions.githubusercontent.com" >/dev/null
    fi

    # 4c. Bind SA to Repo
    gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
        --role="roles/iam.workloadIdentityUser" \
        --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool/attribute.repository/${GH_REPO_NAME}" >/dev/null

    # 4d. Bind Compute Engine Default Service Account to read Artifact Registry (Required for VM to pull image)
    COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
    if ! gcloud projects get-iam-policy "$GCP_PROJECT_ID" --flatten="bindings[].members" --format="table(bindings.role)" --filter="bindings.members:serviceAccount:$COMPUTE_SA" | grep -q "roles/artifactregistry.reader"; then
        gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
            --member="serviceAccount:$COMPUTE_SA" \
            --role="roles/artifactregistry.reader" >/dev/null
        echo "✅ Granted Artifact Registry Reader role to VM Compute Service Account."
    fi

    WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool/providers/github-actions-provider"
    echo "$WIF_PROVIDER" > ./github-actions-wif-provider.txt
    
    echo "✅ WIF configured for repository: $GH_REPO_NAME"

    # 5. Create Firewall Rule
    echo -e "\n[5/6] Checking Firewall Rule ($FIREWALL_RULE_NAME)..."
    if ! gcloud compute firewall-rules describe "$FIREWALL_RULE_NAME" &>/dev/null; then
        gcloud compute firewall-rules create "$FIREWALL_RULE_NAME" \
            --allow tcp:23333,tcp:24444 \
            --source-ranges="0.0.0.0/0" \
            --target-tags="minecraft-server" \
            --description="Allow traffic to MCSManager daemon and panel"
        echo "✅ Firewall Rule created."
    else
        echo "✅ Firewall rule $FIREWALL_RULE_NAME already exists."
    fi

    echo -e "\n[6/6] Launching VM instance..."
    start_vm
    
    echo -e "\n============================================================"
    echo "🎉 Provisioning Complete! 🎉"
    echo "Your WIF Provider String is saved in: ./github-actions-wif-provider.txt"
    echo "Your Service Account Email is: $SA_EMAIL"
    echo "============================================================"
}

# ==============================================================================
# 2. VM LIFECYCLE COMMANDS
# ==============================================================================

function generate_startup_scripts() {
    # Generate Startup Script (Installs Docker for our custom CI/CD flow)
    cat << 'EOF' > /tmp/mc-startup.sh
#!/bin/bash
echo "🏗️ Setting up Infrastructure..."
# If docker isn't installed, install it
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi
# We no longer install the standalone MCSManager here because
# GitHub Actions will deploy it as a Docker container!
EOF

    # Generate Shutdown Script (Gracefully stop docker containers on spot preemption)
    cat << 'EOF' > /tmp/mc-shutdown.sh
#!/bin/bash
echo "🛑 SPOT PREEMPTION DETECTED!"
if command -v docker &> /dev/null; then
    CONTAINERS=$(docker ps -q)
    if [ -n "$CONTAINERS" ]; then
        echo "⚠️ Stopping containers: $CONTAINERS"
        docker stop -t 25 $CONTAINERS
    else
        echo "✅ No active containers."
    fi
fi
EOF
}

function start_vm() {
    if gcloud compute instances describe "$VM_NAME" --zone="$ZONE" &>/dev/null; then
        echo "🚀 Starting existing Host VM in $ZONE..."
        gcloud compute instances start "$VM_NAME" --zone="$ZONE"
    else
        echo "🚀 Creating and Launching new Host VM ($VM_NAME) in $ZONE..."
        generate_startup_scripts
        
        gcloud compute instances create $VM_NAME \
            --project=$GCP_PROJECT_ID \
            --zone=$ZONE \
            --machine-type=$MACHINE_TYPE \
            --image-family=ubuntu-2204-lts \
            --image-project=ubuntu-os-cloud \
            --provisioning-model=SPOT \
            --instance-termination-action=STOP \
            --tags=minecraft-server,http-server \
            --metadata-from-file startup-script=/tmp/mc-startup.sh,shutdown-script=/tmp/mc-shutdown.sh \
            --boot-disk-size=20GB \
            --boot-disk-type=pd-balanced \
            --scopes="https://www.googleapis.com/auth/cloud-platform" \
            --quiet
    fi

    # Get IP
    IP=$(gcloud compute instances describe $VM_NAME --zone=$ZONE --format='value(networkInterfaces[0].accessConfigs[0].natIP)')
    
    echo "----------------------------------------------------"
    echo "✅ VM is running!"
    echo "👉 IP Address: $IP"
    echo "----------------------------------------------------"
}

function stop_vm() {
    echo "🛑 Stopping Host VM..."
    gcloud compute instances stop $VM_NAME --zone=$ZONE
}

function delete_vm() {
    echo "🗑️ Deleting Host VM..."
    gcloud compute instances delete $VM_NAME --zone=$ZONE --quiet
}

function ssh_vm() {
    gcloud compute ssh $VM_NAME --zone=$ZONE
}

# ==============================================================================
# MAIN ROUTER
# ==============================================================================

ACTION=$1

case $ACTION in
  setup)
    setup_infrastructure
    ;;
  start)
    start_vm
    ;;
  stop)
    stop_vm
    ;;
  delete)
    delete_vm
    ;;
  ssh)
    ssh_vm
    ;;
  *)
    echo "Usage: $0 {setup|start|stop|delete|ssh}"
    ;;
esac
