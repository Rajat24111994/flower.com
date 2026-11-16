$ErrorActionPreference = "Stop"

$projectId = "web-ban-hoa-9fe0b"
$databaseId = "(default)"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "Google Cloud CLI (gcloud) was not found. Install it, then run this script again."
}

$activeAccount = & gcloud auth list --filter="status:ACTIVE" --format="value(account)"
if ($LASTEXITCODE -ne 0) {
    throw "Could not check gcloud login status. Run 'gcloud auth login' and try again."
}
if (-not $activeAccount) {
    throw "No active Google Cloud account. Run 'gcloud auth login' and try again."
}

$schedulesJson = & gcloud firestore backups schedules list `
    --database=$databaseId `
    --project=$projectId `
    --format=json
if ($LASTEXITCODE -ne 0) {
    throw "Could not read backup schedules. Check the project, Firestore permissions, billing, and API status."
}

$schedules = @($schedulesJson | ConvertFrom-Json)
if ($schedules.Count -gt 0) {
    Write-Host "Database already has $($schedules.Count) backup schedule(s). Existing schedules were not changed."
    Write-Host "Review them with: gcloud firestore backups schedules list --database=`"$databaseId`" --project=`"$projectId`""
    exit 0
}

& gcloud firestore backups schedules create `
    --database=$databaseId `
    --retention=14w `
    --recurrence=daily `
    --project=$projectId
if ($LASTEXITCODE -ne 0) {
    throw "Could not create the backup schedule. Check Google Cloud project configuration and permissions."
}

Write-Host "Created a daily Firestore backup schedule with 14-week retention for $projectId."
Write-Host "Verify with: gcloud firestore backups schedules list --database=`"$databaseId`" --project=`"$projectId`""
