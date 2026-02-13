EXT_FILE="vscode-extensions.txt"

while IFS= read -r extension
do
    echo "installing $extension..."
    code --install-extension "$extension" --force
done < "$EXT_FILE"
