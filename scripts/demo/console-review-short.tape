# vhs scripts/demo/console-review-short.tape, run from a repo built by make-repo.sh (see record-feature.sh)
Output "console-review-short.mp4"
Set Shell zsh
Set FontSize 19
Set Width 920
Set Height 560
Set Padding 16
Set Theme "GitHub Dark"
Set TypingSpeed 35ms

Hide
Type "setopt interactivecomments; export PATH=$DEMO_BIN:$PATH EDITOR=vim PS1='%F{8}~/shop (feat/invoices)%f ❯ ' && clear"
Enter
Type "codechart render $DEMO_SPEC --git --output web >/dev/null && clear"
Enter
Sleep 3s
Show

Type "codechart review"
Sleep 300ms
Enter
Sleep 1.2s

Type "/coupon_code"
Enter
Sleep 700ms
Type "o"
Type "> should old orders get a default coupon?"
Escape
Sleep 800ms

Type "/HTTPException(404)"
Enter
Sleep 700ms
Type "o"
Type ">? why 404 and not 403?"
Escape
Sleep 900ms

Type ":wq"
Sleep 300ms
Enter
Sleep 1.2s

Type "codechart feedback --take"
Sleep 300ms
Enter
Sleep 3s
