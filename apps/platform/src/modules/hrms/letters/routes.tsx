import React, { lazy, Suspense } from 'react'
import { Route } from 'react-router-dom'
import { RouteGuard } from '@/routes/RouteGuard'
import { P } from '@unifiedtree/sdk'
import { CardSkeleton } from '@unifiedtree/ui-kit'
import { LetterTemplates } from './LetterTemplates'
import { LetterTemplateEditor } from './LetterTemplateEditor'
import { GeneratedLetters } from './GeneratedLetters'
import { GeneratedLetterDetail } from './GeneratedLetterDetail'

const Fallback = () => (
  <div className="p-6">
    <CardSkeleton />
  </div>
)

export function letterRoutes() {
  return (
    <>
      <Route
        path="letters/templates"
        element={
          <RouteGuard anyOf={[P.HRMS_LETTERS_TEMPLATE_READ]}>
            <Suspense fallback={<Fallback />}>
              <LetterTemplates />
            </Suspense>
          </RouteGuard>
        }
      />
      <Route
        path="letters/templates/:id"
        element={
          <RouteGuard anyOf={[P.HRMS_LETTERS_TEMPLATE_READ]}>
            <Suspense fallback={<Fallback />}>
              <LetterTemplateEditor />
            </Suspense>
          </RouteGuard>
        }
      />
      <Route
        path="letters/generated"
        element={
          <RouteGuard anyOf={[P.HRMS_LETTERS_READ]}>
            <Suspense fallback={<Fallback />}>
              <GeneratedLetters />
            </Suspense>
          </RouteGuard>
        }
      />
      <Route
        path="letters/generated/:id"
        element={
          <RouteGuard anyOf={[P.HRMS_LETTERS_READ, P.HRMS_LETTERS_READ_SELF]}>
            <Suspense fallback={<Fallback />}>
              <GeneratedLetterDetail />
            </Suspense>
          </RouteGuard>
        }
      />
    </>
  )
}
