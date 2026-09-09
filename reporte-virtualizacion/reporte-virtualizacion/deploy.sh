#!/usr/bin/env bash
# Despliegue del reporte de virtualizacion en Cloud Run.
# Uso:  ./deploy.sh [PROJECT_ID]
set -euo pipefail

PROJECT="${1:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"
SERVICIO="${SERVICIO:-reporte-virtualizacion}"
REPO="${REPO:-contenedores}"
IMAGEN="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICIO}"
SA="${SERVICIO}-sa"

if [[ -z "${PROJECT}" ]]; then
  echo "Falta el project id. Uso: ./deploy.sh mi-proyecto" >&2
  exit 1
fi

echo "→ Proyecto ${PROJECT} · región ${REGION} · servicio ${SERVICIO}"
gcloud config set project "${PROJECT}" >/dev/null

echo "→ Habilitando APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

if ! gcloud artifacts repositories describe "${REPO}" --location="${REGION}" >/dev/null 2>&1; then
  echo "→ Creando repositorio Artifact Registry ${REPO}"
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker --location="${REGION}" \
    --description="Imágenes de la Dirección de Operaciones"
fi

# Reutiliza el mismo secreto que el reporte de costos si ya existe, para no
# duplicar la contraseña en Secret Manager.
if ! gcloud secrets describe pg-password-reporte >/dev/null 2>&1; then
  echo "→ Creando el secreto pg-password-reporte"
  read -rsp "Contraseña de PostgreSQL para los reportes: " PGPASS; echo
  printf '%s' "${PGPASS}" | gcloud secrets create pg-password-reporte \
    --data-file=- --replication-policy=automatic
  unset PGPASS
else
  echo "→ Reutilizando el secreto pg-password-reporte ya existente"
fi

if ! gcloud iam service-accounts describe "${SA}@${PROJECT}.iam.gserviceaccount.com" >/dev/null 2>&1; then
  echo "→ Creando cuenta de servicio ${SA}"
  gcloud iam service-accounts create "${SA}" \
    --display-name="Reporte de virtualizacion"
fi

gcloud secrets add-iam-policy-binding pg-password-reporte \
  --member="serviceAccount:${SA}@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

echo "→ Construyendo la imagen"
gcloud builds submit --tag "${IMAGEN}"

echo "→ Desplegando en Cloud Run"
gcloud run deploy "${SERVICIO}" \
  --image="${IMAGEN}" \
  --region="${REGION}" \
  --platform=managed \
  --service-account="${SA}@${PROJECT}.iam.gserviceaccount.com" \
  --set-env-vars="PGHOST=136.116.213.121,PGPORT=5432,PGDATABASE=planner_db,PGUSER=planner_user,PGSSLMODE=prefer,FABRICA_SCHEMA=fabrica,CACHE_SEGUNDOS=180" \
  --set-secrets="PGPASSWORD=pg-password-reporte:latest" \
  --min-instances=0 \
  --max-instances=4 \
  --cpu=1 --memory=512Mi \
  --concurrency=40 \
  --timeout=60s \
  --no-allow-unauthenticated

echo
echo "Listo. URL del servicio:"
gcloud run services describe "${SERVICIO}" --region="${REGION}" --format='value(status.url)'
echo
echo "Está cerrado al público (--no-allow-unauthenticated). Para dar acceso a una persona:"
echo "  gcloud run services add-iam-policy-binding ${SERVICIO} --region=${REGION} \\"
echo "    --member='user:alguien@cun.edu.co' --role='roles/run.invoker'"
