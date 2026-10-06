#!/usr/bin/env bash
# Claude Code Statusline - Catppuccin Mocha Blue
# Responsive: single line when wide enough, two lines when narrow.

input=$(cat)

# -- Colors --
c_blue=$'\x1b[38;2;137;180;250m'
c_sapphire=$'\x1b[38;2;116;199;236m'
c_lavender=$'\x1b[38;2;180;190;254m'
c_subtext=$'\x1b[38;2;166;173;200m'
c_overlay=$'\x1b[38;2;108;112;134m'
c_green=$'\x1b[38;2;166;227;161m'
c_yellow=$'\x1b[38;2;249;226;175m'
c_peach=$'\x1b[38;2;250;179;135m'
c_red=$'\x1b[38;2;243;139;168m'
c_mauve=$'\x1b[38;2;203;166;247m'
c_rst=$'\x1b[0m'
c_bold=$'\x1b[1m'

icon_model="🤖"
icon_branch="🌿"
icon_folder="📁"

COLS=$(tput cols 2>/dev/null || echo 120)
SEP_PLAIN=" | "
SEP="${c_overlay}${SEP_PLAIN}${c_rst}"

# Strip ANSI escapes then count chars for visible width measurement.
# Emoji display as 2 columns but count as 1 char — we correct with +EMOJI_BONUS.
strip_ansi() { printf '%s' "$1" | sed $'s/\x1b\\[[0-9;]*m//g'; }
vis_width()  { printf '%s' "$(strip_ansi "$1")" | wc -m | tr -d ' '; }

# Print non-empty segments joined by SEP.
print_line() {
  local first=1
  for seg in "$@"; do
    [ -z "$seg" ] && continue
    [ "$first" -eq 0 ] && printf '%s' "$SEP"
    printf '%s' "$seg"
    first=0
  done
}

# -- Parse JSON --
model=$(echo "$input" | jq -r '.model.display_name // "Claude"')
dir=$(echo "$input"   | jq -r '.workspace.current_dir // ""')
dirname=$(basename "$dir")
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')
ctx_size=$(echo "$input"  | jq -r '.context_window.context_window_size // empty')

# -- Model segment --
seg_model="${c_blue}${c_bold}${icon_model} ${model}${c_rst}"

# -- Context bar segment --
seg_ctx=""
if [ -n "$remaining" ] && [ -n "$ctx_size" ]; then
  rem=${remaining%.*}
  used=$((100 - rem))
  scaled=$(( used * 100 / 80 )); [ "$scaled" -gt 100 ] && scaled=100
  used_k=$(( ctx_size * used / 100000 ))
  if [ "$ctx_size" -ge 1000000 ]; then total_fmt="1M"
  else total_fmt="$((ctx_size / 1000))k"; fi
  filled=$(( scaled * 8 / 100 ))
  bar=""; for ((i=0; i<8; i++)); do [ $i -lt $filled ] && bar="${bar}█" || bar="${bar}░"; done
  if   [ "$scaled" -lt 50 ]; then ctx_c="$c_green"
  elif [ "$scaled" -lt 70 ]; then ctx_c="$c_yellow"
  elif [ "$scaled" -lt 90 ]; then ctx_c="$c_peach"
  else ctx_c="$c_red"; fi
  seg_ctx="${ctx_c}${bar} ${used_k}k/${total_fmt}${c_rst}"
fi

# -- Branch + PR segment --
seg_branch=""
if [ -n "$dir" ] && git -C "$dir" rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git -C "$dir" branch --show-current 2>/dev/null)
  if [ -n "$branch" ]; then
    pr_num=$(cd "$dir" && gh pr view --json number -q '.number' 2>/dev/null)
    seg_branch="${c_mauve}${icon_branch} ${branch}${c_rst}"
    [ -n "$pr_num" ] && seg_branch+=" ${c_sapphire}#${pr_num}${c_rst}"
  fi
fi

# -- Directory segment --
seg_dir="${c_lavender}${icon_folder} ${dirname}${c_rst}"

# -- Git diff stats segment --
seg_stats=""
if [ -n "$dir" ] && git -C "$dir" rev-parse --git-dir > /dev/null 2>&1; then
  stats=$(git -C "$dir" diff --shortstat 2>/dev/null)
  staged=$(git -C "$dir" diff --cached --shortstat 2>/dev/null)
  files=0; ins=0; del=0
  for s in "$stats" "$staged"; do
    [ -z "$s" ] && continue
    f=$(echo "$s" | sed -nE 's/.* ([0-9]+) files? changed.*/\1/p')
    i=$(echo "$s" | sed -nE 's/.* ([0-9]+) insertions?.*/\1/p')
    d=$(echo "$s" | sed -nE 's/.* ([0-9]+) deletions?.*/\1/p')
    [ -n "$f" ] && files=$((files + f))
    [ -n "$i" ] && ins=$((ins + i))
    [ -n "$d" ] && del=$((del + d))
  done
  if [ "$files" -gt 0 ]; then
    seg_stats="${c_subtext}${files} files${c_rst}"
    [ "$ins" -gt 0 ] && seg_stats+=" ${c_green}+${ins}${c_rst}"
    [ "$del" -gt 0 ] && seg_stats+=" ${c_red}-${del}${c_rst}"
  fi
fi

# -- Rate limit helpers --
color_for_pct() {
  if   [ "$1" -lt 50 ]; then echo "$c_green"
  elif [ "$1" -lt 75 ]; then echo "$c_yellow"
  elif [ "$1" -lt 90 ]; then echo "$c_peach"
  else echo "$c_red"; fi
}
fmt_reset() {
  local target=${1%.*} now diff d h m
  now=$(date +%s); diff=$(( target - now ))
  [ "$diff" -le 0 ] && { echo "now"; return; }
  d=$(( diff / 86400 )); h=$(( (diff % 86400) / 3600 )); m=$(( (diff % 3600) / 60 ))
  if   [ "$d" -gt 0 ]; then echo "${d}d ${h}h"
  elif [ "$h" -gt 0 ]; then echo "${h}h ${m}m"
  else echo "${m}m"; fi
}

# -- 5h rate limit segment --
seg_5h=""
five_h=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
if [ -n "$five_h" ]; then
  five_h_int=${five_h%.*}
  lim_c=$(color_for_pct "$five_h_int")
  reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
  seg_5h="${lim_c}5h: ${five_h_int}%${c_rst}"
  [ -n "$reset" ] && seg_5h+=" ${c_overlay}($(fmt_reset "$reset"))${c_rst}"
fi

# -- 7d rate limit segment --
seg_7d=""
seven_d=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
if [ -n "$seven_d" ]; then
  seven_d_int=${seven_d%.*}
  lim_c=$(color_for_pct "$seven_d_int")
  reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
  seg_7d="${lim_c}7d: ${seven_d_int}%${c_rst}"
  [ -n "$reset" ] && seg_7d+=" ${c_overlay}($(fmt_reset "$reset"))${c_rst}"
fi

# -- Layout decision --
# Line 1 (primary): model | context bar
# Line 2 (secondary): branch | dir | git stats | rate limits
# Measure total visible width of all segments; use two lines if it won't fit.

ALL=("$seg_model" "$seg_ctx" "$seg_branch" "$seg_dir" "$seg_stats" "$seg_5h" "$seg_7d")

total_vis=0; count=0
for seg in "${ALL[@]}"; do
  [ -z "$seg" ] && continue
  total_vis=$(( total_vis + $(vis_width "$seg") ))
  count=$(( count + 1 ))
done
# Add separator widths (3 chars each) + emoji double-width correction (4 emoji max)
[ "$count" -gt 1 ] && total_vis=$(( total_vis + (count - 1) * ${#SEP_PLAIN} ))
total_vis=$(( total_vis + 4 ))

if [ "$total_vis" -le "$COLS" ]; then
  print_line "${ALL[@]}"
else
  print_line "$seg_model" "$seg_dir" "$seg_branch"
  echo ""
  print_line "$seg_ctx" "$seg_stats" "$seg_5h" "$seg_7d"
fi
