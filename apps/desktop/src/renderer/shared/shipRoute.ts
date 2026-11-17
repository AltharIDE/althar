import type { ShipFar as Far, ShipRoute as Route, ShipStop as Stop } from '@althar/contracts'
import { ShipFar, type ShipRoute, ShipStop } from '@althar/ui'

/*
 * Ship's route as the runtime says it and as the kit draws it: the same three
 * lengths and four stops, one in words, the other as the kit's vocabulary.
 */

export const kitFar = (far: Far): ShipFar => {
  switch (far) {
    case 'push':
      return ShipFar.Push
    case 'ready':
      return ShipFar.Ready
    case 'merge':
      return ShipFar.Merge
  }
}

export const farOf = (far: ShipFar): Far => {
  switch (far) {
    case ShipFar.Push:
      return 'push'
    case ShipFar.Ready:
      return 'ready'
    case ShipFar.Merge:
      return 'merge'
  }
}

export const kitRoute = (route: Route): ShipRoute => ({ review: route.review, far: kitFar(route.far) })
export const routeOf = (route: ShipRoute): Route => ({ review: route.review, far: farOf(route.far) })

export const kitStop = (stop: Stop): ShipStop => {
  switch (stop) {
    case 'review':
      return ShipStop.Review
    case 'push':
      return ShipStop.Push
    case 'ready':
      return ShipStop.Ready
    case 'merge':
      return ShipStop.Merge
  }
}
