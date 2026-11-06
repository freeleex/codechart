# vhs scripts/demo/review.tape, run from a repo built by make-repo.sh (see record-review.sh)
Output "review-term.gif"
Set Shell zsh
Set FontSize 15
Set Width 1280
Set Height 780
Set Padding 20
Set Theme "GitHub Dark"
Set TypingSpeed 40ms

Hide
Type "setopt interactivecomments; export PATH=$DEMO_BIN:$DEMO_DIR:$PATH EDITOR=vim PS1='%F{8}~/shop (feat/invoices)%f ❯ ' && clear"
Enter
Show

Sleep 600ms
Type "agent 'add invoices for paid orders and a refund endpoint behind a flag'"
Enter
Sleep 5s

Type "# I want to review this in the terminal:"
Enter
Sleep 400ms
Type "codechart review"
Sleep 300ms
Enter
Sleep 2.5s

Type "/coupon_code"
Enter
Sleep 900ms
Type "o"
Type "> should old orders get a default coupon? nullable looks risky"
Escape
Sleep 1.2s

Type "/HTTPException(404)"
Enter
Sleep 900ms
Type "o"
Type ">? why 404 and not 403 when the flag is off?"
Escape
Sleep 1.2s

Type "/WHERE status"
Enter
Sleep 900ms
Type "o"
Type ">del drop the backfill here, we run it as a job"
Escape
Sleep 1.5s

Type ":wq"
Sleep 400ms
Enter
Sleep 2.5s

Type "# I tell the agent 'review done'; it runs:"
Enter
Sleep 400ms
Type "codechart feedback --take"
Sleep 300ms
Enter
Sleep 6s
