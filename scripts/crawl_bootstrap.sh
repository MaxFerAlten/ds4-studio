ensure_crawl_service() {
  local root_dir="$1"
  local service_dir="$root_dir/crawl_service"
  local venv_dir="$service_dir/.venv"
  local venv_python="$venv_dir/bin/python3"

  if [[ -x "$venv_python" ]] && "$venv_python" -c 'import ds4_crawl' >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "srun.sh: python3 is required to bootstrap crawl_service virtualenv" >&2
    return 1
  fi

  if [[ ! -x "$venv_python" ]]; then
    echo "srun.sh: crawl_service virtualenv not ready, creating"
    python3 -m venv "$venv_dir"
    "$venv_python" -m pip install --upgrade pip
  else
    echo "srun.sh: crawl_service installation incomplete, reinstalling"
  fi

  "$venv_python" -m pip install -e "$service_dir"
}
