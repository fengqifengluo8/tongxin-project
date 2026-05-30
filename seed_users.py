"""生成 BCrypt 密码哈希并输出 SQL"""
import bcrypt

users = [
    ("commander", "123456", "commander", "指挥官"),
    ("officer1",  "123456", "officer",   "警员张三"),
    ("officer2",  "123456", "officer",   "警员李四"),
    ("guest1",    "123456", "guest",     "访客"),
]

print("USE tongxin;")
for username, password, role, nickname in users:
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    sql = f"INSERT IGNORE INTO user (username, password, role, nickname) VALUES ('{username}', '{hashed}', '{role}', '{nickname}');"
    print(sql)
