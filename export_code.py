import os
import sys
import argparse
from datetime import datetime

EXCLUDE_DIRS = {
    'node_modules', '.git', '.svn', '__pycache__', '.pytest_cache',
    '.mypy_cache', '.tox', '.venv', 'venv', 'env', '.env',
    'dist', 'build', 'out', '.next', '.nuxt', '.cache', 'coverage',
    '.idea', '.vscode', 'target', 'bin', 'obj', '.gradle',
    '.dart_tool', '.pub-cache', 'Pods', 'DerivedData', '.ai-agent-temp',
}

EXCLUDE_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.tif', '.tiff', '.psd', '.ai', '.eps', '.raw', '.cr2', '.nef',
    '.heic', '.heif', '.avif',
    '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.ogv',
    '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus',
    '.mid', '.midi',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz', '.zst', '.tgz',
    '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.lib',
    '.pyc', '.pyo', '.class', '.jar', '.war', '.wasm', '.map',
    '.db', '.sqlite', '.sqlite3', '.mdb',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.bin', '.dat', '.iso', '.img', '.dmg', '.vsix', '.lock',
}

EXCLUDE_FILES = {
    '.DS_Store', 'Thumbs.db', 'desktop.ini',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'composer.lock', 'go.sum',
}

MAX_FILE_SIZE = 200 * 1024


def is_text_file(filepath):
    try:
        with open(filepath, 'rb') as f:
            chunk = f.read(8192)
            if b'\x00' in chunk:
                return False
            return True
    except (IOError, PermissionError):
        return False


def should_include(filepath, filename):
    if filename in EXCLUDE_FILES:
        return False
    _, ext = os.path.splitext(filename)
    if ext.lower() in EXCLUDE_EXTENSIONS:
        return False
    try:
        size = os.path.getsize(filepath)
        if size > MAX_FILE_SIZE or size == 0:
            return False
    except OSError:
        return False
    if not is_text_file(filepath):
        return False
    return True


def strip_comments(content, ext):
    if ext not in ('.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.go',
                   '.c', '.cpp', '.h', '.hpp', '.cs', '.rs', '.rb',
                   '.php', '.swift', '.kt', '.scala', '.sh', '.bash',
                   '.ps1', '.r', '.pl', '.lua'):
        return content

    lines = content.split('\n')
    result = []

    for line in lines:
        stripped = line.strip()

        if not stripped:
            result.append(line)
            continue

        has_chinese = any('\u4e00' <= ch <= '\u9fff' for ch in stripped)

        if not has_chinese:
            result.append(line)
            continue

        if ext in ('.py', '.rb', '.sh', '.bash', '.ps1', '.r', '.pl'):
            if stripped.startswith('#'):
                continue
            hash_pos = line.find('#')
            if hash_pos > 0:
                before = line[:hash_pos].rstrip()
                if before:
                    result.append(before)
                    continue
            result.append(line)

        elif ext in ('.js', '.ts', '.jsx', '.tsx', '.java', '.go',
                     '.c', '.cpp', '.h', '.hpp', '.cs', '.rs',
                     '.swift', '.kt', '.scala', '.lua'):
            if stripped.startswith('//'):
                continue
            slash_pos = line.find('//')
            if slash_pos > 0:
                before = line[:slash_pos].rstrip()
                if before:
                    result.append(before)
                    continue
            result.append(line)

        else:
            result.append(line)

    return '\n'.join(result)


def collect_files(root_dir):
    files = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [
            d for d in dirnames
            if d not in EXCLUDE_DIRS and not d.startswith('.')
        ]
        dirnames.sort()
        for filename in sorted(filenames):
            filepath = os.path.join(dirpath, filename)
            relpath = os.path.relpath(filepath, root_dir)
            if should_include(filepath, filename):
                files.append((relpath, filepath))
    return files


def export_project(root_dir, output_file):
    root_dir = os.path.abspath(root_dir)
    if not os.path.isdir(root_dir):
        print(f"Error: directory not found -> {root_dir}")
        sys.exit(1)

    print(f"Scanning: {root_dir}")
    files = collect_files(root_dir)
    print(f"Found {len(files)} code files")

    if not files:
        print("No code files found!")
        sys.exit(1)

    total_lines = 0

    with open(output_file, 'w', encoding='utf-8') as out:
        out.write("=" * 80 + "\n")
        out.write(f"Project: {root_dir}\n")
        out.write(f"Exported: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        out.write(f"Files: {len(files)}\n")
        out.write("=" * 80 + "\n\n")

        for i, (relpath, filepath) in enumerate(files, 1):
            size = os.path.getsize(filepath)
            out.write(f"  {i:3d}. {relpath.replace(os.sep, '/')} ({size:,} bytes)\n")
        out.write("\n" + "=" * 80 + "\n\n")

        for i, (relpath, filepath) in enumerate(files, 1):
            try:
                with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()

                _, ext = os.path.splitext(filepath)
                content = strip_comments(content, ext.lower())

                lines = content.count('\n') + 1
                total_lines += lines
                normalized = relpath.replace('\\', '/')

                out.write(f"{'#' * 80}\n")
                out.write(f"# [{i}/{len(files)}] {normalized}\n")
                out.write(f"# Lines: {lines}  Size: {os.path.getsize(filepath):,} bytes\n")
                out.write(f"{'#' * 80}\n\n")
                out.write(content)
                if not content.endswith('\n'):
                    out.write('\n')
                out.write('\n')

            except Exception as e:
                out.write(f"# [Read failed: {e}]\n\n")

        out.write("=" * 80 + "\n")
        out.write(f"Total files: {len(files)}\n")
        out.write(f"Total lines: {total_lines:,}\n")
        out.write("=" * 80 + "\n")

    output_size = os.path.getsize(output_file)
    print(f"\nDone!")
    print(f"  Files: {len(files)}")
    print(f"  Lines: {total_lines:,}")
    print(f"  Output: {output_file}")
    print(f"  Size: {output_size:,} bytes ({output_size/1024:.1f} KB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', nargs='?', default='.')
    parser.add_argument('-o', '--output', default=None)
    parser.add_argument('--max-size', type=int, default=200)
    args = parser.parse_args()

    global MAX_FILE_SIZE
    MAX_FILE_SIZE = args.max_size * 1024

    root_dir = os.path.abspath(args.directory)
    if args.output:
        output_file = args.output
    else:
        output_file = f"{os.path.basename(root_dir)}_code_export.txt"

    export_project(root_dir, output_file)


if __name__ == '__main__':
    main()
# 导出当前目录的项目python export_code.py
# 导出指定目录python export_code.py D:\桌面\ai-code-agent
# 指定输出文件名python export_code.py D:\桌面\ai-code-agent -o my_project.txt
# 调大单文件上限（比如 500KB）python export_code.py D:\桌面\ai-code-agent --max-size 500