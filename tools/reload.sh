node /c/Users/Bacon/abyssal_tools/cdp.mjs "location.reload(); 1" >/dev/null; sleep 5
for i in $(seq 1 20); do sleep 6; r=$(node /c/Users/Bacon/abyssal_tools/cdp.mjs "typeof dev"); case "$r" in *object*) echo loaded; exit 0;; esac; done; echo timeout
