import os
import shutil
import subprocess
import tempfile
from pathlib import Path
import time
import json
import socket
import logging

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

def get_free_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('0.0.0.0', 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def find_repo_root():
    current = Path.cwd()
    for path in [current, *current.parents]:
        if (path / "package.json").exists():
            return path
    raise Exception("Could not find repo root")

# Run a mock actor core server on the given port
# returns a function to stop the server
def start_mock_server():
    logger.info("Starting mock server")

    # Get repo root
    repo_root = find_repo_root()
    logger.info(f"Found repo root: {repo_root}")
    
    # Build actor-core
    logger.info("Building actor-core")
    subprocess.run(
        ["yarn", "build", "-F", "actor-core"],
        cwd=repo_root,
        check=True
    )
    
    # Create temporary directory
    temp_dir = tempfile.mkdtemp()
    temp_path = Path(temp_dir)
    logger.info(f"Created temp directory at: {temp_path}")
    
    # Create vendor directory
    vendor_dir = temp_path / "vendor"
    vendor_dir.mkdir(parents=True)
    
    # Pack packages
    packages = [
        ("actor-core", repo_root / "packages/actor-core"),
        ("nodejs", repo_root / "packages/platforms/nodejs"),
        ("memory", repo_root / "packages/drivers/memory")
    ]
    
    logger.info("Packing packages (3 total)")
    for name, path in packages:
        output_path = vendor_dir / f"actor-core-{name}.tgz"
        subprocess.run(
            ["yarn", "pack", "--out", str(output_path)],
            cwd=path,
            check=True
        )
    
    # Copy counter example
    logger.info("Copying counter example to temp directory")
    counter_source = repo_root / "examples/counter"
    counter_dest = temp_path / "counter"
    shutil.copytree(counter_source, counter_dest)
    
    # Create server script
    logger.info("Creating server start script")
    server_dir = temp_path / "counter"
    server_script_path = server_dir / "src/server.ts"
    

    port = get_free_port()
    server_script = f"""
import {{ app }} from "./index.ts";
import {{ serve }} from "@actor-core/nodejs";

serve(app, {{ port: {port} }});
"""
    
    server_script_path.write_text(server_script)
    
    # Create package.json
    logger.info("Creating package.json")
    package_json = {
        "name": "actor-core-python-test",
        "packageManager": "yarn@4.2.2",
        "private": True,
        "type": "module",
        "dependencies": {
            "actor-core": f"file:{vendor_dir}/actor-core-actor-core.tgz",
            "@actor-core/nodejs": f"file:{vendor_dir}/actor-core-nodejs.tgz",
            "@actor-core/memory": f"file:{vendor_dir}/actor-core-memory.tgz"
        },
        "devDependencies": {
            "tsx": "^3.12.7"
        }
    }

    package_json_path = server_dir / "package.json"
    package_json_path.write_text(json.dumps(package_json, indent=2))
    
    # Write .yarnrc.yml
    logger.info("Creating .yarnrc.yml")
    yarnrc_path = server_dir / ".yarnrc.yml"
    yarnrc_path.write_text("nodeLinker: node-modules\n")
    
    # Install dependencies
    logger.info("Installing dependencies")
    subprocess.run(
        ["yarn"],
        cwd=server_dir,
        check=True
    )
    
    # Start the server
    logger.info("Starting the server")
    process = subprocess.Popen(
        ["npx", "tsx", "src/server.ts"],
        cwd=server_dir
    )
    
    # Wait a bit for the server to start
    time.sleep(2)
    
    # Return cleanup function
    def stop_mock_server():
        logger.info("Stopping mock server")
        process.kill()
        shutil.rmtree(temp_dir)
    
    return ("http://127.0.0.1:" + str(port), stop_mock_server)

