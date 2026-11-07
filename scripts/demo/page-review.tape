# vhs scripts/demo/page-review.tape, run from a repo built by make-repo.sh (see record-page-review.sh)
Output "page-review-term.mp4"
Set Shell zsh
Set FontSize 15
Set Width 1180
Set Height 620
Set Padding 24
Set Theme "GitHub Dark"
Set TypingSpeed 35ms

Hide
Type "setopt interactivecomments; export PATH=$DEMO_BIN:$PATH PS1='%F{8}~/shop%f ❯ ' && clear"
Enter
Show

Sleep 600ms
Type "# I paste the copied review into the agent chat; it runs:"
Enter
Sleep 300ms
Type "codechart feedback --import --take < review.txt"
Sleep 300ms
Enter
Sleep 4s
