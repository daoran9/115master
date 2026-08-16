import { appLogger } from '@/utils/logger'

const logger = appLogger.sub('ShadowStyle')
const styleSheetsByDocument = new WeakMap<Document, Map<string, CSSStyleSheet>>()

/**
 * 向 Shadow DOM 注入可复用样式。
 *
 * Chromium 支持构造样式表时，同一文档内所有详情组件共享解析结果；
 * 不支持时回退为普通 style 节点。
 */
export function adoptShadowStyle(shadowRoot: ShadowRoot, cssText: string): void {
  /**
   * ================================================================================
   * 步骤1：复用文档级构造样式表
   * ================================================================================
   * 目标：避免长列表中每个 Shadow DOM 重复解析完整样式。
   * 数据源：当前 ShadowRoot 所属文档和内联 CSS 文本。
   * 操作：
   * 1) 按文档和 CSS 文本查找已解析样式表
   * 2) 首次使用时创建，后续直接复用
   */
  const ownerDocument = shadowRoot.ownerDocument
  const StyleSheet = ownerDocument.defaultView?.CSSStyleSheet

  if (StyleSheet && 'adoptedStyleSheets' in shadowRoot) {
    let documentSheets = styleSheetsByDocument.get(ownerDocument)
    if (!documentSheets) {
      documentSheets = new Map()
      styleSheetsByDocument.set(ownerDocument, documentSheets)
    }

    let styleSheet = documentSheets.get(cssText)
    if (!styleSheet) {
      logger.info('开始创建共享 Shadow DOM 样式表')
      try {
        styleSheet = new StyleSheet()
        styleSheet.replaceSync(cssText)
        documentSheets.set(cssText, styleSheet)
        logger.info('共享 Shadow DOM 样式表创建完成')
      }
      catch (error) {
        logger.warn('共享 Shadow DOM 样式表创建失败，使用普通样式节点', error)
      }
    }

    if (styleSheet) {
      shadowRoot.adoptedStyleSheets = [
        ...shadowRoot.adoptedStyleSheets,
        styleSheet,
      ]
      return
    }
  }

  /*
   * ================================================================================
   * 步骤2：兼容普通样式节点
   * ================================================================================
   * 目标：保证不支持构造样式表的浏览器仍能显示详情。
   * 操作：
   * 1) 创建 style 节点
   * 2) 写入 ShadowRoot
   */
  logger.info('开始写入兼容 Shadow DOM 样式节点')
  const styleElement = ownerDocument.createElement('style')
  styleElement.textContent = cssText
  shadowRoot.appendChild(styleElement)
  logger.info('兼容 Shadow DOM 样式节点写入完成')
}
