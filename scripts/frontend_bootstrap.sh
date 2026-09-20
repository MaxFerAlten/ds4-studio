ensure_frontend_dependencies() {
  local root_dir="$1"
  local frontend_dir="$root_dir/frontend"

  [[ -f "$frontend_dir/package.json" ]] || {
    echo "srun.sh: frontend/package.json is missing" >&2
    return 1
  }

  if [[ -d "$frontend_dir/node_modules" ]] &&
     npm --prefix "$frontend_dir" ls --depth=0 >/dev/null 2>&1; then
    return 0
  fi

  echo "srun.sh: installing or repairing frontend dependencies"
  npm --prefix "$frontend_dir" install
}
