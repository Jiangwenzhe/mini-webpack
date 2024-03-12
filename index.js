const path = require("path");
const fs = require("fs");
const acorn = require("acorn");
const walk = require("acorn-walk");
const escodegen = require("escodegen");

let moduleId = 0;

const writeToDistFile = (code) => {
  const distPath = path.join(__dirname, "dist");
  const outputPath = path.join(distPath, "output.js");

  // 检查 dist 目录是否存在，如果存在，则删除
  if (fs.existsSync(distPath)) {
    fs.rmdirSync(distPath, { recursive: true });
  }

  // 重新创建 dist 目录
  fs.mkdirSync(distPath, { recursive: true });

  // 将 code 写入 output.js
  fs.writeFileSync(outputPath, code, "utf-8");

  console.log(`File written to ${outputPath}`);
};

const buildModule = (entry) => {
  // 入口地址转化为绝对路径
  const filename = path.resolve(__dirname, entry);
  const code = fs.readFileSync(filename, "utf-8");

  const ast = acorn.parse(code, {
    sourceType: "module",
    ecmaVersion: "2020",
  });

  const deps = [];
  const currentModuleId = moduleId;

  walk.simple(ast, {
    CallExpression(node) {
      if (node.callee.name === "require" && node.callee.type === "Identifier") {
        // argument 就是 require 函数的第一个参数，就是引用的模块
        const argument = node.arguments[0];

        if (argument.type === "Literal") {
          moduleId++;
          const nextFileName = path.join(
            path.dirname(filename),
            argument.value
          );
          // 这里把 require('xxx') => require(moduleId)
          argument.value = moduleId;
          deps.push(buildModule(nextFileName));
        }
      }
    },
  });

  return {
    filename,
    deps,
    code: escodegen.generate(ast),
    id: currentModuleId,
  };
};

const moduleTreeToQueue = (moduleTree) => {
  const { deps, ...module } = moduleTree;

  const moduleQueue = deps.reduce(
    (acc, m) => {
      return acc.concat(moduleTreeToQueue(m));
    },
    [module]
  );

  return moduleQueue;
};

// 实现一个类似 commonjs 的 wrapper
const createModuleWrapper = (code) => {
  return `
  (function(exports, require, module) {
    ${code}
  })`;
};

const createBundleTemplate = (entry) => {
  // 获取所有依赖
  const moduleTree = buildModule(entry);
  const modules = moduleTreeToQueue(moduleTree);

  // 生成打包的模板，也就是打包的真正过程
  const bundledCode = `
// 统一扔到块级作用域中，避免污染全局变量
// 为了方便，这里使用 {}，而不用 IIFE
//
// 以下代码为打包的三个重要步骤：
// 1. 构建 modules
// 2. 构建 webpackRequire，加载模块，模拟 CommonJS 中的 require
// 3. 运行入口函数
{
  // 1. 构建 modules
  const modules = [
    ${modules.map((m) => createModuleWrapper(m.code))}
  ]

  // 模块缓存，所有模块都仅仅会加载并执行一次
  const cacheModules = {}

  // 2. 加载模块，模拟代码中的 require 函数
  // 打包后，实际上根据模块的 ID 加载，并对 module.exports 进行缓存
  function webpackRequire (moduleId) {
    const cachedModule = cacheModules[moduleId]
    if (cachedModule) {
      return cachedModule.exports
    }
    const targetModule = { exports: {} }
    modules[moduleId](targetModule.exports, webpackRequire, targetModule)
    cacheModules[moduleId] = targetModule
    return targetModule.exports
  }

  // 3. 运行入口函数
  webpackRequire(0)
}
`;
  writeToDistFile(bundledCode);
};

module.exports = createBundleTemplate;
