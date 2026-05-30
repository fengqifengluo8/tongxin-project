"""直接通过 pymysql 连接并导入种子用户"""
import pymysql
import bcrypt

users = [
    ("commander", "123456", "commander", "指挥官"),
    ("officer1",  "123456", "officer",   "警员张三"),
    ("officer2",  "123456", "officer",   "警员李四"),
    ("guest1",    "123456", "guest",     "访客"),
]

conn = pymysql.connect(host="127.0.0.1", port=3306, user="root", password="123456",
                       database="tongxin", charset="utf8mb4")
cursor = conn.cursor()

for username, password, role, nickname in users:
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    try:
        cursor.execute(
            "INSERT IGNORE INTO user (username, password, role, nickname) VALUES (%s, %s, %s, %s)",
            (username, hashed, role, nickname)
        )
        print(f"OK: {username} ({role})")
    except Exception as e:
        print(f"FAIL: {username} - {e}")

conn.commit()

# 验证
cursor.execute("SELECT id, username, role, nickname FROM user")
print("\n=== 当前用户表 ===")
for row in cursor.fetchall():
    print(f"  id={row[0]}  username={row[1]}  role={row[2]}  nickname={row[3]}")

cursor.close()
conn.close()
print("\nDone!")
