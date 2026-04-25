###  第一阶段：引擎点火 (启动服务)

每次你想让大模型重新“上班”时，在学校的 LXD 容器 (`zlr`) 中按顺序执行以下两步：

0. ###### 清理“僵尸隧道”（云服务器 + 实验室容器 双端清理）

   请求卡死，旧的隧道一定已经变成“僵尸”了。我们必须把它彻底关闭。

   **1. 在云服务器上（释放 8080 端口）：** 登录云服务器，把占着 8080 端口的假死 SSH 进程干掉：

   Bash

   ```
   sudo fuser -k 8080/tcp
   sudo lsof -t -i:8080 | xargs -r sudo kill -9
   ```
   
   *(如果没有输出说明已经被清理，如果有输出数字说明成功超度。)*
   
   **2. 在学校容器上（清理本地残余）：** 回到实验室的终端，清理掉可能卡死的 autossh 或 ssh 进程：
   
   Bash
   
   ```
   pkill -9 -f autossh
   
   ps aux | grep 8080
   kill -9 12345
   ```

```
# 强杀 vLLM 主进程及所有子 Worker
pkill -9 -f vllm
```

**1. 启动 vLLM 视觉推理引擎 (占用终端，或用 tmux 挂载)**

Bash

#### 开辟专属的虚拟房间tmux，防止关掉终端vllm关闭

在终端里输入以下命令，创建一个名为 `vllm_engine` 的 tmux 会话（房间）：

Bash

```
tmux new -s vllm_engine
```

```
conda activate vllm

NCCL_DEBUG=INFO python -m vllm.entrypoints.openai.api_server \
    --model ~/models/qwen/Qwen2-VL-7B-Instruct \
    --served-model-name qwen-vl-7b \
    --pipeline-parallel-size 3 \
    --gpu-memory-utilization 0.6 \
    --max-model-len 16384 \
    --limit-mm-per-prompt '{"image": 9}' \
    --port 8000 \
    --api-key sk-xingyue-super-secret-2026 # 新增这一行，这就是你的商业级秘钥
```

*(提示：看到 `Uvicorn running on http://0.0.0.0:8000` 表示引擎就绪。)*

 **tmux 最核心的快捷键：** 先按键盘上的 `Ctrl` + `B` （按完松开这俩键），然后紧接着按一下字母 `D` (代表 Detach)。

你会瞬间“退”回到原来的普通终端，屏幕上会提示 `[detached (from session vllm_engine)]`。 **此时，你就算直接暴力关闭你电脑上的 SSH 终端软件，vLLM 也绝对不会死了！**

你想看看模型有没有报错，或者想看看实时的推理日志。重新 SSH 连上学校的容器，输入：

Bash

```
tmux attach -t vllm_engine
```

（也可以简写为 `tmux a -t vllm_engine`）。

**么在 tmux 里向上翻看日志？** 在普通的终端里你可以用鼠标滚轮上下翻，但在 tmux 里一滚鼠标就乱套了。

- **正确翻页姿势：** 按 `Ctrl` + `B`，松开，再按 `[`。此时右上角会出现行号，你就可以用键盘的上、下方向键，或者 `PageUp`/`PageDown` 来翻看历史日志了。
- **退出翻页模式：** 按一下 `Q` 键，恢复正常状态。

**怎么查看我开了几个房间？** 在普通终端输入：`tmux ls`

**怎么彻底炸毁这个房间（关掉 vLLM）？** 如果你不想用了，有两种方法：

- 方法 A：进入房间 (`tmux a -t vllm_engine`)，然后按 `Ctrl + C` 杀掉 vLLM，接着输入 `exit` 回车，房间就彻底销毁了。
- 方法 B：在普通终端直接执行“强拆”：`tmux kill-session -t vllm_engine`

**2. 启动后台守护隧道 (打通外网)** 另开一个容器终端执行：

Bash

```
autossh -M 20000 -N -R 8080:localhost:8000 ubuntu@192.144.201.219 -f
```

此版本是30秒防止连接断连

```
autossh -M 20000 -N -R 8080:localhost:8000 ubuntu@192.144.201.219 -f -o ServerAliveInterval=30 -o ServerAliveCountMax=3
```

*(💡 提示：`-f` 代表它会默默在后台运行，敲完终端就自由了。)*

------

### 🧪 第二阶段：联通测试 

如果你发现星月日记网站的大模型没反应，用这三条命令来“摸脉”，一步步排查断在哪里：

**1. 摸内网脉 (在容器里测 vLLM 活着没)：**

Bash

没有api加密版本

```
curl http://localhost:8000/v1/models
```

这是公开api版本

```
curl http://localhost:8000/v1/models \
  -H "Authorization: Bearer sk-xingyue-super-secret-2026"
```

*正常结果：瞬间返回 `qwen-vl-7b` 的 JSON 数据。*

**2. 摸外网脉 (在云服务器里测隧道通了没)：**

Bash

没有api加密版本

```
curl http://127.0.0.1:8080/v1/models
```

这是公开api版本

```
curl http://127.0.0.1:8080/v1/models \
  -H "Authorization: Bearer sk-xingyue-super-secret-2026"
```

*正常结果：瞬间返回 JSON 数据，说明 8080 到 8000 的穿透完美。*

**3. 检查隧道进程 (在容器里看 autossh 还在不在)：**

Bash

```
ps aux | grep autossh
```

*正常结果：能看到带有 `autossh -M 20000...` 的长进程。*

------

### 第三阶段：停机与清场 (释放显卡做其他事)

当你需要用这 3 张 3090 去跑其他训练脚本时，必须干净利落地清场，防止显存僵尸。

**1. 温和派关机 (在容器内操作)**

Bash

```
# 强杀 vLLM 主进程及所有子 Worker
pkill -9 -f vllm

# 强杀后台的隐秘隧道
pkill -9 -f autossh
```

**2. 暴力派清场 (在宿主机操作，最彻底)** 如果发现显卡明明没人用，但 `nvidia-smi` 里面显存依然被占着（比如卡在 14000MiB），直接在宿主机 (`li@gpuserver:~$`) 执行核弹指令：

Bash

```
# 无差别击杀所有占用显卡的进程 (需 sudo 权限)
sudo fuser -k -9 /dev/nvidia0 /dev/nvidia1 /dev/nvidia2
```

# 云服务器

### 重启后端服务（重载入内存）

更新后端代码后，在云服务器终端执行：

Bash

```
pm2 restart all
```

日志：*重启完之后，你可以敲这行命令看一眼实时的后端日志：

Bash

```
pm2 logs
```

这个时候，你再去前端网站点击一下那个紫色的 **“重试”** 按钮。 此时，新的代码生效，请求会精准地打向 `http://127.0.0.1:8080/v1`，顺着我们刚才打通的隧道，直达你实验室的 3090 显卡。去见证奇迹吧！

前端，浏览器刷新即可

```
npm run build
```

