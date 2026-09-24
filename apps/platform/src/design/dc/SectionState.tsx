// Ported from the design component SectionState.dc.html.
import { DCLogic, dc } from './dc-runtime'
import { SectionStateView } from './SectionState.view'
import { dashIcon, dashIconComponent } from './icons'

export class SectionState extends DCLogic {
  renderVals() {
    const k = this.props.kind || 'loading'
    const h = Number(this.props.height) || 72
    return {
      isLoading: k === 'loading', isEmpty: k === 'empty', isError: k === 'error',
      title: this.props.title || 'No records for this period.',
      description: this.props.description || '',
      retry: this.props.retry || (() => {}),
      emptyIcon: dashIconComponent(this.props.icon || 'inbox'),
      errorIcon: dashIcon('circleX', 18),
      skA: { style: { height: 14, width: '40%', borderRadius: 6 } },
      skB: { style: { height: h, width: '100%', borderRadius: 10 } },
      skC: { style: { height: 14, width: '70%', borderRadius: 6 } },
    }
  }
  render() { return dc(this, SectionStateView, 'SectionState') }
}
