"""
🔴 RED BOT (Python 3)
Mục tiêu: Đưa quân tới ô đích A1 (r=8, c=0) để chiến thắng!
Giao thức: Đọc JSON state từ stdin, in JSON move ra stdout.
"""
import sys
import json

def distance(r1, c1, r2, c2):
    return max(abs(r1 - r2), abs(c1 - c2))

def get_next_move(state):
    legal_moves = state.get("legalMoves", [])
    my_goal = state.get("myGoal", {"r": 8, "c": 0})
    
    if not legal_moves:
        return None

    # 1. Thắng ngay nếu chạm đích A1
    for m in legal_moves:
        if m["to"]["r"] == my_goal["r"] and m["to"]["c"] == my_goal["c"]:
            return m

    # 2. Đánh giá điểm số di chuyển
    best_move = legal_moves[0]
    best_score = -float('inf')

    for m in legal_moves:
        score = 0
        cur_dist = distance(m["from"]["r"], m["from"]["c"], my_goal["r"], my_goal["c"])
        new_dist = distance(m["to"]["r"], m["to"]["c"], my_goal["r"], my_goal["c"])
        score += (cur_dist - new_dist) * 40

        if m.get("capture") is not None:
            score += 100

        if score > best_score:
            best_score = score
            best_move = m

    return best_move

if __name__ == "__main__":
    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    raw_input = sys.stdin.read()
    if raw_input.strip():
        state = json.loads(raw_input)
        chosen_move = get_next_move(state)
        if chosen_move:
            print(json.dumps({
                "from": chosen_move["from"],
                "to": chosen_move["to"]
            }), flush=True)
