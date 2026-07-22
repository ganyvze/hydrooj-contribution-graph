# @hydrooj/contribution-graph

为 HydroOJ 用户主页添加 **历史贡献图**。

<img width="859" height="428" alt="light demo" src="https://github.com/user-attachments/assets/9aebc10e-60e2-4126-8ff2-62e9ddadb383" />

<img width="864" height="427" alt="dark demo" src="https://github.com/user-attachments/assets/8f122227-e34d-437e-aa88-02edb3544396" />


## 功能

以卡片形式展示在个人主页下方，包含一张可按年份查看的每日解题热力图，

- 历史累计解题数
- 最近一年解题数
- 最近一月解题数
- 最长连续解题天数
- 最近一年最长连续天数
- 最近一月最长连续天数

其中「解题」按**去重后的题目**计算：同一道题只在其 **AC** 的那天计入一次。

## 安装

```bash
hydrooj addon add /绝对路径/hydro-contribution-graph
pm2 restart hydrooj    # 或使用你自己的方式重启 hydrooj
```

也可以直接在 HydroOJ 所在主机上运行 `./deploy.sh`。

## 配置（可选）

通过控制面板 设置：

- `contribution.timezone` —— 用于按天分组的时区，默认 `Asia/Shanghai`。
- `contribution.cacheTtl` —— 统计缓存的有效期（毫秒），默认 `600000`。

## 许可证

AGPL-3.0-or-later.
